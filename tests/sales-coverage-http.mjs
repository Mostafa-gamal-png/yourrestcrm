// «اكتمال سجل المبيعات» from the ERP sales import, over HTTP against the BUILT release (run the build first). Synthetic data only: a
// temporary SQLite, mocked sendmail, ERP sales reports built here as XLSX (the real parser reads them). The months are the real clock's:
// the evaluation month M is last month (finished); the file runs from M-4 to M.
// - The import: the tick «الملف يشمل كل مبيعات المناديب للفترة التي يغطيها» is off by default (no coverage written), records one coverage
//   entry in the import's own row and audit line when ticked (by default the file's first to last invoice; widened to whole months when
//   asked, never beyond them); a period outside the file's months is refused; a retry with another choice is another request (409); a
//   replay returns the same; a file with documents needing mapping cannot be complete; a supervisor's entry covers their team only.
// - The KPIs (GET /api/sales?kpis=1, «بيانات المؤشرات»): without coverage, growth, retention and recovered wait and name the months; the
//   manual confirmation still completes them; a file whose first and last months are partial leaves those months uncovered; whole months
//   make all three automatic, a product with no sale counting as zero; the default activity targets (10, 5, 320) apply until a target is
//   saved, which then wins and is carried forward; a finished month stays locked to the administrator.
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {bootBuiltApp} from '../scripts/lib/built-app.mjs';

const members=[
 {id:'owner',role:'admin',name:'مدير النظام'},{id:'sm',role:'manager',region:'eastern',name:'مدير المبيعات'},{id:'sup',role:'supervisor',sup:'sm',region:'eastern',name:'المشرف'},
 {id:'rep1',role:'rep',sup:'sup',region:'eastern',name:'مندوب ألف'},{id:'rep2',role:'rep',sup:'sup',region:'eastern',name:'مندوب باء'},
 {id:'rep9',role:'rep',sup:'sm',region:'eastern',name:'مندوب خارج الفريق'},{id:'cs',role:'customer_service',name:'خدمة العملاء'}
];
const riyadh=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}),today=riyadh.format(new Date()),current=today.slice(0,7);
const shift=n=>{const d=new Date(current+'-15T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+n);return d.toISOString().slice(0,7);};
const end=m=>m+'-'+String(new Date(Date.UTC(Number(m.slice(0,4)),Number(m.slice(5,7)),0)).getUTCDate()).padStart(2,'0');
const M=shift(-1),M1=shift(-2),M2=shift(-3),M3=shift(-4),M4=shift(-5),M5=shift(-6);
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const HEADERS=['رقم الفاتورة','التاريخ','النوع','رقم الصنف','اسم الصنف','الفئة','الكمية','الوحدة','سعر الوحدة','الخصم','الإجمالي','القيمة المضافة','رقم العميل','اسم العميل','رقم الموظف','اسم الموظف'];
const A='قوالب البلوك المتحركة';
function report(lines){
 const cells=l=>[l.reference,l.date,'فاتورة مبيعات','M1','قالب',l.product||A,String(l.quantity??1),'حبة','1000.00','0',(1000*(l.quantity??1)).toFixed(2),(150*(l.quantity??1)).toFixed(2),l.customer,'مصنع '+l.customer,l.employee||'E1',l.name||'مندوب ألف'];
 const row=values=>`<row>${values.map(v=>`<c t="str"><v>${escape(v)}</v></c>`).join('')}</row>`;
 return Buffer.from(zipSync({
  '[Content_Types].xml':strToU8('<?xml version="1.0"?><Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'),
  'xl/workbook.xml':strToU8('<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>'),
  'xl/_rels/workbook.xml.rels':strToU8('<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
  'xl/worksheets/sheet1.xml':strToU8(`<worksheet><sheetData>${[HEADERS,...lines.map(cells)].map(row).join('')}</sheetData></worksheet>`),
 })).toString('base64');
}
// rep1: C-REC bought in M-4, nothing in M-3..M-1, again in M (recovered); C-RET in M-2 and M (retained); C-LAP in M-1 only (not
// retained). Product A: 2 in M-1, 4 in M (+100%). rep2: one invoice in M.
const lines=[
 {reference:'S-OLD',date:M4+'-10',customer:'C-REC'},
 {reference:'S-RET1',date:M2+'-10',customer:'C-RET'},
 {reference:'S-LAP',date:M1+'-10',customer:'C-LAP',quantity:2},
 {reference:'S-REC',date:M+'-05',customer:'C-REC',quantity:3},
 {reference:'S-RET2',date:M+'-20',customer:'C-RET'},
 {reference:'S-B2',date:M+'-12',customer:'C-B',employee:'E2',name:'مندوب باء'},
];
let checks=0,app;
const check=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;},ok=(v,m)=>{assert.ok(v,m);checks++;};
try{
 app=await bootBuiltApp({members});
 const sessions={};for(const m of members)sessions[m.id]=await app.login(m.id);
 const as=who=>app.as(who?sessions[who]:'');
 const url='/api/sales/import',mappings=[{employeeId:'E1',repId:'rep1'},{employeeId:'E2',repId:'rep2'}];
 const body=(base64,fields={})=>({action:'preview',fileName:'Sales.xlsx',base64,employeeMappings:mappings,categoryMappings:[],...fields});
 const post=(who,payload)=>as(who)(url,{method:'POST',body:payload});
 async function importFile(base64,commitFields={},who='owner',status=200,fields={}){
  const preview=await post(who,body(base64,fields));if(preview.status!==200)console.error(preview.text,app.log().slice(-2000));check(preview.status,200,'preview');
  const result=await post(who,body(base64,{...fields,action:'commit',previewToken:preview.json().previewToken,requestId:crypto.randomUUID(),...commitFields}));
  if(result.status!==status)console.error(result.text);check(result.status,status,'commit '+JSON.stringify(commitFields));
  return {preview:preview.json(),result:result.json()};
 }
 const entries=async()=>(await app.db.prepare("SELECT json_extract(result,'$.coverage') AS c FROM crm_erp_imports WHERE json_extract(result,'$.coverage') IS NOT NULL ORDER BY created_at,rowid").all()).results.map(r=>JSON.parse(r.c));
 const config=(await as('owner')(url)).json(),P=config.products;
 // Weights of M (a finished month: the administrator): A and B half each, so B (no sale anywhere) shows the zero-fill.
 const weights={products:P.map((product,i)=>({product,weight:i<2?50:0}))};
 check((await as('owner')('/api/targets',{method:'POST',body:{kind:'weights',scopeId:'company',month:M,version:0,inheritedFrom:null,requestId:crypto.randomUUID(),data:weights}})).status,200,'weights saved for '+M);
 const kpi=async(who='sm',month=M)=>{const reply=await as(who)('/api/sales?month='+month+'&kpis=1');if(reply.status!==200)console.error(reply.text);check(reply.status,200,'KPI read');return reply.json();};
 const person=(payload,id)=>payload.kpis.people.find(p=>p.member.id===id),metric=(payload,id,kind)=>person(payload,id).metrics.find(m=>m.id===kind);

 // ---- access unchanged
 check((await post('',body(report(lines),{action:'commit',completeSnapshot:true}))).status,401,'no session: 401');
 for(const who of ['rep1','cs'])check((await post(who,body(report(lines),{action:'commit',completeSnapshot:true}))).status,403,who+': 403 even with the tick');

 // ---- 1. unticked (the default): imported as before, no coverage
 let run=await importFile(report(lines));
 check([run.result.importedCount,'coverage' in run.result],[6,false],'unticked: imported as before, no coverage');
 check(run.preview.coverage,{first:M4+'-10',last:M+'-20',minFrom:M4+'-01',maxTo:end(M),months:{full:[M3,M2,M1],partial:[M4,M]},repCount:3,allReps:true,blocker:''},'the preview says what a complete file would cover');
 check(await entries(),[],'nothing recorded');
 let payload=await kpi();
 check([metric(payload,'rep1','growth').score,metric(payload,'rep1','retention').score,metric(payload,'rep1','recovered').score],[null,null,null],'not covered: the three wait');
 check(metric(payload,'rep1','retention').missing,{months:[M3,M2,M1,M],olderThan:null},'retention names the four months');
 check(metric(payload,'rep1','recovered').missing.olderThan,M3,'recovered also needs a month before '+M3);
 ok(metric(payload,'rep1','retention').reason.startsWith('يلزم رفع مبيعات ERP كاملة لأشهر '),'in Arabic, named');
 check(metric(payload,'rep1','growth').missing,{months:[M1,M],olderThan:null},'growth names '+M1+' and '+M);
 check(person(payload,'rep1').attainment.rows[1].actual,null,'not covered: a product without sales stays unknown');

 // ---- 2. the manual confirmation is still a fallback
 let options=(await as('sm')('/api/kpi-evidence?memberId=rep1&month='+M)).json();
 check([options.coverage.current,options.coverage.recovered],[false,false],'«بيانات المؤشرات» says the imports do not cover the month yet');
 const confirm=await as('sm')('/api/kpi-evidence',{method:'POST',body:{memberId:'rep1',month:M,version:0,requestId:crypto.randomUUID(),salesRevision:options.salesRevision,evidenceRevision:options.evidenceRevision,input:{collection:{dueCents:null,collectedCents:null,reference:''},history:{complete:true,reference:'ERP report'},quotationsComplete:false,quotations:[]}}});
 check(confirm.status,200,'manual confirmation saved');
 payload=await kpi();
 check([metric(payload,'rep1','retention').score,metric(payload,'rep1','recovered').numerator,metric(payload,'rep1','growth').score,'missing' in metric(payload,'rep1','retention')],[50,1,100,false],'the manual confirmation completes the three, as before');

 // ---- 3. ticked, default period: the first and last months are partial
 run=await importFile(report(lines),{completeSnapshot:true});
 check([run.result.importedCount,run.result.duplicateCount],[0,6],'the same file again: all duplicates');
 check([run.result.coverage.from,run.result.coverage.to,run.result.coverage.months,run.result.coverage.partialMonths,run.result.coverage.allReps,run.result.coverage.importer],[M4+'-10',M+'-20',[M3,M2,M1],[M4,M],true,'مدير النظام'],'recorded from the first to the last invoice');
 payload=await kpi();
 check([metric(payload,'rep1','retention').score,metric(payload,'rep1','retention').missing],[null,{months:[M],olderThan:null}],'the manual confirmation went stale with the import; '+M+' is only partly in the file');
 check(metric(payload,'rep1','recovered').missing,{months:[M],olderThan:M3},M4+' from the 10th is not a whole older month');

 // ---- 4. a period outside the file's months, and a retry with another choice
 let refused=await importFile(report(lines),{completeSnapshot:true,coverageFrom:shift(-6)+'-28',coverageTo:end(M)},'owner',400);
 ok(refused.result.error.includes('فترة الاكتمال'),'a period before the file\'s first month is refused');
 refused=await importFile(report(lines),{completeSnapshot:true,coverageFrom:M4+'-11'},'owner',400);
 ok(refused.result.error.includes('تشمل كل تواريخ'),'a period leaving out an invoice is refused');
 const preview=(await post('owner',body(report(lines)))).json(),requestId=crypto.randomUUID();
 check((await post('owner',body(report(lines),{action:'commit',previewToken:preview.previewToken,requestId}))).status,200,'committed unticked');
 check((await post('owner',body(report(lines),{action:'commit',previewToken:preview.previewToken,requestId,completeSnapshot:true}))).status,409,'the same request ticked is another request: 409');
 check((await entries()).length,1,'no coverage written by the refused requests');

 // ---- 5. ticked, widened to whole months: all three automatic
 const wideId=crypto.randomUUID(),widePreview=(await post('owner',body(report(lines)))).json(),wide={action:'commit',previewToken:widePreview.previewToken,requestId:wideId,completeSnapshot:true,coverageFrom:M4+'-01',coverageTo:end(M)};
 const saved=await post('owner',body(report(lines),wide));check(saved.status,200,'committed ticked');
 check([saved.json().coverage.months,saved.json().coverage.partialMonths],[[M4,M3,M2,M1,M],[]],'whole months');
 check((await post('owner',body(report(lines),wide))).json().alreadySaved,true,'a replay returns the same receipt');check((await entries()).length,2,'and writes nothing more');
 const audit=JSON.parse((await app.db.prepare("SELECT detail FROM crm_audit WHERE id=?").bind('erp-import-'+wideId).first()).detail);
 check([audit.coverage.from,audit.coverage.to,audit.coverage.importerId,audit.coverage.importId],[M4+'-01',end(M),'owner','erp-import-'+wideId],'the audit line holds the coverage, who and which import');
 payload=await kpi();
 const ret=metric(payload,'rep1','retention'),rec=metric(payload,'rep1','recovered'),gro=metric(payload,'rep1','growth');
 check([ret.numerator,ret.denominator,ret.score,ret.source],[1,2,50,'automatic'],'retention computes by itself');
 check([rec.numerator,rec.denominator,rec.score,rec.source],[1,5,20,'automatic'],'recovered by itself, against the default recovery target 5');
 check([gro.score,gro.source],[100,'automatic'],'growth by itself');
 ok(ret.reason.includes('سجل المبيعات مكتمل تلقائيًا'),'the reason says so');ok(!('missing' in ret),'no missing months');
 check([person(payload,'rep1').attainment.rows[1].actual,person(payload,'rep1').growthRows[1].previous],[0,0],'within covered months a product without sales is a zero');
 check(metric(payload,'rep2','retention').status,'not_applicable','rep2 had no buyer in the three months: not applicable, not waiting (every rep is covered)');
 options=(await as('sm')('/api/kpi-evidence?memberId=rep1&month='+M)).json();
 check([options.coverage.growth,options.coverage.retention,options.coverage.recovered,options.coverage.through],[true,true,true,end(M)],'«بيانات المؤشرات» says the manual confirmation is no longer needed');
 const team=(await kpi('sup')).kpis.people.find(p=>p.member.id==='sup');
 ok(team.metrics.find(m=>m.id==='retention').score!==null,'the supervisor\'s team row is covered too');

 // ---- 6. a supervisor: the team only; documents needing mapping block the tick
 const unmapped=report([{reference:'S-NEW',date:M5+'-12',customer:'C-REC'},{reference:'S-UNK',date:M5+'-13',customer:'C-X',employee:'E7',name:'موظف غير مربوط'}]);
 const blocked=(await post('sup',body(unmapped,{employeeMappings:[{employeeId:'E1',repId:'rep1'}]}))).json();
 check(blocked.coverage.blocker,'لا يمكن تأكيد اكتمال الملف وفيه مستندات تحتاج ربطًا؛ أكمل الربط أولًا.','the preview says why it cannot be complete');
 const blockedCommit=await post('sup',body(unmapped,{employeeMappings:[{employeeId:'E1',repId:'rep1'}],allowSkipped:true,action:'commit',previewToken:(await post('sup',body(unmapped,{employeeMappings:[{employeeId:'E1',repId:'rep1'}],allowSkipped:true}))).json().previewToken,requestId:crypto.randomUUID(),completeSnapshot:true}));
 check([blockedCommit.status,blockedCommit.json().error],[409,blocked.coverage.blocker],'and the commit refuses it');
 run=await importFile(report([{reference:'S-NEW',date:M5+'-12',customer:'C-REC'}]),{completeSnapshot:true},'sup',200,{employeeMappings:[{employeeId:'E1',repId:'rep1'}]});
 check([run.result.coverage.repIds,run.result.coverage.allReps],[['rep1','rep2'],false],'a supervisor\'s complete file speaks for their team only');

 // ---- 7. default activity targets: applied, overridden, carried forward; finished months locked
 payload=await kpi();
 check([metric(payload,'rep1','new_customers').denominator,metric(payload,'rep1','visits').denominator,metric(payload,'rep1','recovered').denominator,person(payload,'rep1').activityTargetsDefault],[10,320,5,true],'no activity target saved: 10, 320 and 5, marked as defaults');
 check((await as('sm')('/api/targets',{method:'POST',body:{kind:'activity',scopeId:'rep1',month:M,version:0,inheritedFrom:null,requestId:crypto.randomUUID(),data:{newCustomers:3,recoveredCustomers:2,visits:40}}})).status,403,'the sales manager cannot set the finished month');
 check((await as('owner')('/api/targets',{method:'POST',body:{kind:'activity',scopeId:'rep1',month:M,version:0,inheritedFrom:null,requestId:crypto.randomUUID(),data:{newCustomers:3,recoveredCustomers:2,visits:40}}})).status,200,'the administrator can');
 payload=await kpi();
 check([metric(payload,'rep1','new_customers').denominator,metric(payload,'rep1','visits').denominator,metric(payload,'rep1','recovered').denominator,metric(payload,'rep1','recovered').score,person(payload,'rep1').activityTargetsDefault],[3,40,2,50,false],'a saved target wins over the defaults');
 check([metric(payload,'rep2','recovered').denominator,person(payload,'rep2').activityTargetsDefault],[5,true],'another rep keeps the defaults');
 payload=await kpi('sm',current);
 check([metric(payload,'rep1','new_customers').denominator,person(payload,'rep1').activityTargetsDefault],[3,false],'carried forward to '+current);

 // ---- 8. readers
 check([(await as('rep1')('/api/sales?month='+M+'&kpis=1')).status,(await as('')('/api/sales?month='+M+'&kpis=1')).status],[403,401],'a representative and nobody signed in read no KPIs');
 check((await as('rep1')('/api/kpi-evidence?memberId=rep1&month='+M)).status,403,'nor the evidence');
 console.log(JSON.stringify({ok:true,checks,syntheticFixtures:true,productionDataUsed:false}));
}finally{await app?.stop();}
