import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';

// «معدل تحويل عرض السعر إلى مبيعات» computed by itself (the owner, 2026-11-11: «الفواتير مربوطة بعروض السعر فى عمود الوصف»), with
// synthetic data only: the references of «الوصف» (lib/quotation-refs.ts), the ERP sales report read with and without the column
// (lib/erp-sales.ts, real XLSX bytes), the import through its real route on migrated SQLite (a file without the column unchanged, the
// same file again unchanged, the column added later backfilling the saved invoices without a change or a conflict), and the KPI
// through the real /api/sales?kpis=1 (by description, by a manual link, both, a return, another representative, an invoice before the
// quote, a draft, a quote of the next month, a finished month invoiced in the next one, no quotations: not applicable).
const root=process.cwd(),runtime=path.join(root,'.sites-runtime');fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'quote-conversion-')),seen=new Set();
process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const id=globalThis.testIdentity;if(!id)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version,email FROM crm_members WHERE id=?').bind(id).first();return {memberId:m?.id,memberVersion:m?.auth_version,email:m?.email};}`);
function compile(relative){
 if(seen.has(relative))return;seen.add(relative);
 const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});
 let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
  if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));
  if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));
  if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
  let rel=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
  if(!/\.(tsx?|json)$/.test(rel))rel+=fs.existsSync(path.join(root,rel+'.ts'))?'.ts':'.tsx';
  compile(rel);return 'from '+JSON.stringify(path.join(out,rel.replace(/\.tsx?$/,'.mjs')));
 });fs.writeFileSync(dest,code);
}
for(const file of ['lib/quotation-refs.ts','lib/erp-sales.ts','lib/kpis.ts','app/api/sales/route.ts','app/api/sales/import/route.ts','app/api/kpi-evidence/route.ts'])compile(file);
const {quotationRefs,quotationRefKey,storedQuotationRefs,MAX_QUOTATION_REFS}=await import(path.join(out,'lib/quotation-refs.mjs'));
const {parseErpWorkbook}=await import(path.join(out,'lib/erp-sales.mjs'));
const {quoteConversions,calculateKpis}=await import(path.join(out,'lib/kpis.mjs'));
let checks=0;const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;},ok=(a,message)=>{assert.ok(a,message);checks++;};

// 1. The references a description holds.
for(const [text,refs] of [
 ['Qut-349',['Qut-349']],['Qut 349',['Qut-349']],['QUT-349',['Qut-349']],['qut349',['Qut-349']],['Qut-٣٤٩',['Qut-349']],['Qut-۳۴۹',['Qut-349']],
 ['Qut – 349',['Qut-349']],['Qut_349',['Qut-349']],['Qut#349',['Qut-349']],['Qut-0349',['Qut-349']],['Qut‏-349',['Qut-349']],['  Qut-349  ',['Qut-349']],
 ['توريد حسب عرض السعر Qut-12 وعرض QUT 13، ومرة أخرى Qut-12',['Qut-12','Qut-13']],['عرضQut-7',['Qut-7']],['(Qut-8)',['Qut-8']],['Qut-9/2026',['Qut-9']],
 ['Qut-1 Qut-2 Qut-3',['Qut-1','Qut-2','Qut-3']],
 ['',[]],[null,[]],[undefined,[]],['فاتورة بيع',[]],['Quotation 349',[]],['ABCQut-1',[]],['2Qut-1',[]],['Qut-',[]],['Q-349',[]],['Qutaiba 12',[]],['Qut-1234567890',[]],
])eq(quotationRefs(text),refs,'quotationRefs('+JSON.stringify(text)+')');
eq(quotationRefs(Array.from({length:80},(_,i)=>'Qut-'+(i+1)).join(' ')).length,MAX_QUOTATION_REFS,'At most 50 references for one text');
eq(quotationRefs('x'.repeat(4000)+' Qut-5'),['Qut-5'],'A very long cell is read');
for(const [number,key] of [['Qut-349','Qut-349'],['qut 0349','Qut-349'],['QUT-٣٤٩','Qut-349'],['Q-12',null],['Qut-1 Qut-2',null],['عرض Qut-1',null],['',null],[null,null],['CNT-9',null]])eq(quotationRefKey(number),key,'quotationRefKey('+JSON.stringify(number)+')');
eq(storedQuotationRefs(['Qut-1','Qut-1','bad','Qut-x',7,'Qut-2']),['Qut-1','Qut-2'],'A stored list keeps only well-formed references, once');eq(storedQuotationRefs(null),[]);eq(storedQuotationRefs('Qut-1'),[]);

// 2. The ERP sales report with and without a description column (real XLSX bytes).
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const baseHeaders=['رقم الفاتورة','التاريخ','النوع','رقم الصنف','اسم الصنف','الفئة','الكمية','الوحدة','سعر الوحدة','الخصم','الإجمالي','القيمة المضافة','رقم العميل','اسم العميل','رقم الموظف','اسم الموظف'];
function xlsx(rows){
 const rowXml=cells=>`<row>${cells.map(v=>`<c t="str"><v>${escape(v)}</v></c>`).join('')}</row>`;
 return zipSync({
  '[Content_Types].xml':strToU8('<?xml version="1.0"?><Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'),
  'xl/workbook.xml':strToU8('<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>'),
  'xl/_rels/workbook.xml.rels':strToU8('<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
  'xl/worksheets/sheet1.xml':strToU8(`<worksheet><sheetData>${rows.map(rowXml).join('')}</sheetData></worksheet>`),
 });
}
// line: one invoice line; description undefined = the report has no description column.
const product='قوالب البلوك المتحركة';
const line=({reference,date,type='فاتورة مبيعات',item='M1',quantity=1,total=1000,customer='C1',employee='E1',name='مندوب أ'})=>[reference,date,type,item,'قالب',product,String(quantity),'حبة','1000.00','0',total.toFixed(2),(total*0.15).toFixed(2),customer,'مصنع '+customer,employee,name];
function report(lines,{header='الوصف',withDescription=true}={}){
 const headers=withDescription?[...baseHeaders.slice(0,5),header,...baseHeaders.slice(5)]:baseHeaders;
 return xlsx([headers,...lines.map(l=>{const cells=line(l);return withDescription?[...cells.slice(0,5),l.description??'',...cells.slice(5)]:cells;})]);
}
let parsed=parseErpWorkbook(report([{reference:'INV-A',date:'2026-10-10',description:'حسب عرض Qut-101'}],{withDescription:false}));
eq([parsed.hasDescription,parsed.rows[0].description],[false,''],'A report without the column is read as before: no description');
for(const header of ['الوصف','البيان','Description','description',' الوصف '])eq(parseErpWorkbook(report([{reference:'INV-A',date:'2026-10-10',description:'حسب عرض Qut-101'}],{header})).rows[0].description,'حسب عرض Qut-101','The description column is found as «'+header+'»');
parsed=parseErpWorkbook(report([{reference:'INV-A',date:'2026-10-10',description:''},{reference:'INV-B',date:'2026-10-10',description:'  عرض‏ QUT ٣٠١  '}]));
eq([parsed.hasDescription,parsed.rows.map(r=>r.description)],[true,['','عرض QUT ٣٠١']],'An empty cell is empty; spaces and direction marks are cleaned');
eq(quotationRefs(parsed.rows[1].description),['Qut-301']);
eq(parseErpWorkbook(report([{reference:'INV-A',date:'2026-10-10',description:'x'.repeat(5000)}])).rows[0].description.length,2000,'A very long description is kept to 2000 characters');
const twoColumns=xlsx([[...baseHeaders,'الوصف','البيان'],[...line({reference:'INV-A',date:'2026-10-10'}),'Qut-1','Qut-2']]);
eq(parseErpWorkbook(twoColumns).rows[0].description,'Qut-1 | Qut-2','Two description columns are read together');

// 3. The pure matching.
const candidate=(quoteId,number,date='2026-10-05',repId='rep',manualInvoices=[])=>({quoteId,number,date,repId,customerName:'مصنع',manualInvoices});
const invoice=(id,refs,date='2026-10-10',repId='rep')=>({id,reference:id,repId,date,quotationRefs:refs});
let matched=quoteConversions([candidate('a','Qut-1'),candidate('b','Qut-2',undefined,undefined,['MAN-1']),candidate('c','QUT 3',undefined,undefined,['MAN-2']),candidate('d','Qut-4'),candidate('e','Qut-5','2026-10-20'),candidate('f','Q-6'),candidate('g','Qut-7')],
 [invoice('INV-1',['Qut-1','Qut-3']),invoice('INV-2',['Qut-1']),invoice('INV-3',['Qut-4'],undefined,'rep2'),invoice('INV-4',['Qut-5'],'2026-10-15'),invoice('INV-5',['Qut-6']),invoice('INV-6',['Qut-7'],'2026-11-03')]);
eq(matched.map(q=>[q.quoteId,q.converted,q.invoices,q.via]),[
 ['a',true,['INV-1','INV-2'],['description']],['b',true,['MAN-1'],['manual']],['c',true,['INV-1','MAN-2'],['description','manual']],
 ['d',false,[],[]],['e',false,[],[]],['f',false,[],[]],['g',true,['INV-6'],['description']],
],'By description (several invoices), by manual link, both; another representative\'s invoice, an invoice before the quote and a number that is not an ERP quotation do not convert; a later month does');
eq(quoteConversions([],[invoice('INV-1',['Qut-1'])]),[],'No quotations, nothing');
// The metric: converted ÷ quotations; none: not applicable; unknown scope: missing.
const performance={member:{id:'rep',name:'rep',role:'rep',branch:'HQ'},sourceMemberIds:['rep'],salesSourceMemberIds:['rep'],teamRollup:false,activityTeamRollup:false,activityTargetsKnown:true,activityTargets:{newCustomers:1,recoveredCustomers:1,visits:1},attainment:{rows:[],score:null,status:'missing_inputs',applicableWeight:null}};
const context=quotations=>({historyComplete:false,collection:null,purchases:[],quotationsKnown:true,quotations,recoveryTarget:null});
const orders=result=>{const m=result.metrics.find(m=>m.id==='orders');return [m.numerator,m.denominator,m.score,m.status,m.source];};
eq(orders(calculateKpis(performance,'2026-10',[],[],null,undefined,context(matched))),[4,7,57.14,'scored','automatic'],'Converted ÷ quotations');
eq(orders(calculateKpis(performance,'2026-10',[],[],null,undefined,context([...matched,{...matched[0],converted:false,invoices:[],via:[]}]))),[4,7,57.14,'scored','automatic'],'A quotation listed twice counts once and stays converted');
eq(orders(calculateKpis(performance,'2026-10',[],[],null,undefined,context([]))).slice(0,4),[0,0,null,'not_applicable'],'No quotations: not applicable');
eq(orders(calculateKpis({...performance,salesSourceMemberIds:[]},'2026-10',[],[],null,undefined,context(matched))).slice(0,4),[null,null,null,'missing'],'No sales team: unknown');
eq(orders(calculateKpis(performance,'2026-10',[],[],null)).slice(0,4),[null,null,null,'missing'],'No evidence context at all: unknown');
ok(calculateKpis(performance,'2026-10',[],[],null,undefined,context(matched)).metrics.find(m=>m.id==='orders').reason.includes('«الوصف»'),'The calculation is explained');
eq(calculateKpis(performance,'2026-10',[],[],null,undefined,context(matched)).quotations.filter(q=>q.converted).map(q=>q.number),['Qut-1','Qut-2','QUT 3','Qut-7'],'The person carries the quotations with their numbers');

// 4. The import and the KPI through the real routes on migrated SQLite.
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const file of fs.readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+file,'utf8'));
class Statement{constructor(q,a=[]){this.q=q;this.a=a;}bind(...a){return new Statement(this.q,a);}async run(){const result=sql.prepare(this.q).run(...this.a);return{meta:{changes:Number(result.changes)}};}async all(){return{results:sql.prepare(this.q).all(...this.a)};}async first(){return sql.prepare(this.q).get(...this.a)||null;}}
const DB={prepare:q=>new Statement(q),batch:async statements=>{sql.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid',YR_AUTH_SECRET:'a'.repeat(64)};
const salesApi=await import(path.join(out,'app/api/sales/route.mjs')),importApi=await import(path.join(out,'app/api/sales/import/route.mjs')),evidenceApi=await import(path.join(out,'app/api/kpi-evidence/route.mjs'));
const now='2024-01-01T00:00:00.000Z';
function member(id,role='rep',region='eastern',supervisor='sup'){sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,1,0,?)').run(id,'u-'+id,id+'@yourrest.org',id,role,'HQ',supervisor,region,now);}
member('admin','admin','all','');member('manager','manager','eastern','');member('sup','supervisor','eastern','manager');member('rep');member('rep2');member('other','rep','eastern','unrelated-supervisor');
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-admin')").run();
function record(id,kind,parent,assigned,data){sql.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id,kind,parent,assigned,'HQ',JSON.stringify(data),now,now);}
for(const [id,code,rep] of [['c1','C1','rep'],['c2','C2','rep2'],['c9','C9','other']])record(id,'customer',null,rep,{name:'مصنع '+code,code,region:'الشرقية',_createdBy:rep});
function quote(id,number,{customer='c1',rep='rep',date='2026-10-05',status='sent'}={}){record(id,'quote',customer,rep,{performedBy:rep,number,date,validUntil:'2026-12-31',status,items:[{description:'قالب',quantity:1,price:1000}],discount:0,taxRate:15,terms:'',subtotal:1000,tax:150,total:1150});}
quote('q101','Qut-101');                                // INV-1 names it: converted (and a manual link to the same invoice: both)
quote('q102','Qut-102',{date:'2026-10-06',status:'accepted'});  // named by INV-2 of the next month: converted for the finished month
quote('q103','Qut-103',{date:'2026-10-07',status:'rejected'});  // named only by a return: not converted, still a quotation
quote('q104','Qut-104',{status:'draft'});               // a draft is not an issued quotation
quote('q105','Qut-105',{date:'2026-11-01'});            // the next month's quotation
quote('q106','Qut-106',{date:'2026-10-08'});            // named by rep2's invoice: not this representative's conversion
quote('q107','Qut-107',{date:'2026-10-20'});            // named by an invoice dated before it
quote('q77','Q-77',{date:'2026-10-09'});                // a CRM number: converted only by the manual link below
quote('q500','Qut-500',{customer:'c9',rep:'other'});     // another team's: never in this supervisor's view
const manual=(id,{customer='c1',rep='rep',date='2026-10-12'}={})=>sql.prepare("INSERT INTO crm_sales(id,customer_id,rep_id,branch,date,reference,reference_key,data,total_cents,status,void_reason,version,mutation_id,create_fingerprint,created_by,created_at,updated_at) VALUES(?,?,?,'HQ',?,?,?,?,100000,'confirmed','',1,'fixture','fixture','admin',?,?)").run(id,customer,rep,date,id,id,JSON.stringify({items:[{product,quantity:1,unitPrice:1000,description:'قالب'}],discount:0}),now,now);
manual('MAN-77');
const jsonRequest=(url,body)=>new Request('https://test.invalid'+url,{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json'},body:JSON.stringify(body)});
async function responseJson(response,status=200){const data=await response.json();eq(response.status,status,JSON.stringify(data));return data;}
const user=id=>{globalThis.testIdentity=id;};
const mappings=[{employeeId:'E1',repId:'rep'},{employeeId:'E2',repId:'rep2'},{employeeId:'E9',repId:'other'}];
const body=(bytes,extra={})=>({action:'preview',fileName:'sales.xlsx',base64:Buffer.from(bytes).toString('base64'),employeeMappings:mappings,categoryMappings:[],...extra});
async function importFile(bytes){const preview=await responseJson(await importApi.POST(jsonRequest('/api/sales/import',body(bytes))));const result=await responseJson(await importApi.POST(jsonRequest('/api/sales/import',{...body(bytes),action:'commit',previewToken:preview.previewToken,requestId:crypto.randomUUID()})));return {preview,result};}
const lines=[
 {reference:'INV-1',date:'2026-10-10',description:'توريد حسب عرض السعر Qut-101'},{reference:'INV-1',date:'2026-10-10',item:'M2',description:''},
 {reference:'INV-2',date:'2026-11-02',description:'QUT 102 و Qut-٣٠١'},
 {reference:'RET-1',date:'2026-10-11',type:'مردودات المبيعات',quantity:-1,total:-1000,description:'Qut-103'},
 {reference:'INV-3',date:'2026-10-12',customer:'C2',employee:'E2',name:'مندوب ب',description:'Qut-106'},
 {reference:'INV-4',date:'2026-10-15',description:'Qut-107'},
 {reference:'INV-5',date:'2026-10-16',description:'بدون عرض'},
 {reference:'INV-9',date:'2026-10-16',customer:'C9',employee:'E9',name:'مندوب ج',description:'Qut-500'},
];
const stored=()=>Object.fromEntries(sql.prepare('SELECT reference,content_hash,mapped_hash,data FROM crm_erp_sales ORDER BY reference').all().map(r=>[r.reference,{hash:r.content_hash+r.mapped_hash,refs:JSON.parse(r.data).quotationRefs}]));
const count=table=>sql.prepare('SELECT count(*) AS n FROM '+table).get().n;
user('admin');
// A report without the column: imported exactly as before (no references, no quotation counts in the answers).
let run=await importFile(report(lines,{withDescription:false}));
eq([run.result.importedCount,run.result.duplicateCount,'quotationLinkedCount' in run.result,'quotationRefsBackfillCount' in run.result,'quotationLinkedCount' in run.preview.summary],[7,0,false,false,false],'Without the column: the same answer as before');
const before=stored();eq(Object.values(before).every(row=>row.refs===undefined),true,'Without the column nothing about quotations is stored');
// The same file again: unchanged duplicates.
run=await importFile(report(lines,{withDescription:false}));eq([run.result.importedCount,run.result.duplicateCount,run.preview.summary.conflictCount],[0,7,0],'The same file again changes nothing');
// The same invoices with the description column: duplicates, not conflicts; their references are backfilled once, nothing else moves.
run=await importFile(report(lines));
eq([run.preview.summary.newCount,run.preview.summary.duplicateCount,run.preview.summary.conflictCount,run.preview.summary.quotationLinkedCount,run.preview.summary.quotationRefsBackfillCount],[0,7,0,5,6],'Adding the column: identical documents stay duplicates, six take their references (five sales invoices name a quotation)');
eq([run.result.importedCount,run.result.duplicateCount,run.result.quotationRefsBackfillCount,run.result.quotationLinkedCount],[0,7,6,5]);
let after=stored();eq(Object.fromEntries(Object.entries(after).map(([k,v])=>[k,v.hash])),Object.fromEntries(Object.entries(before).map(([k,v])=>[k,v.hash])),'Content and mapped hashes are unchanged by the backfill');
eq(Object.fromEntries(Object.entries(after).map(([k,v])=>[k,v.refs])),{'INV-1':['Qut-101'],'INV-2':['Qut-102','Qut-301'],'INV-3':['Qut-106'],'INV-4':['Qut-107'],'INV-5':undefined,'INV-9':['Qut-500'],'RET-1':['Qut-103']},'Each invoice keeps the references of its lines (an invoice naming none is left untouched)');
const audit=JSON.parse(sql.prepare("SELECT detail FROM crm_audit WHERE action='استيراد مبيعات ERP' ORDER BY created_at DESC,rowid DESC LIMIT 1").get().detail);
eq([audit.quotationRefsBackfillCount,audit.importedCount],[6,0],'The backfill is counted once in the import\'s audit line');
eq(count('crm_audit'),3,'One audit line for each import, no line of its own for a backfilled invoice');
// Again with the column: nothing to backfill. Again without it: the saved references stay.
run=await importFile(report(lines));eq([run.result.duplicateCount,run.result.quotationRefsBackfillCount],[7,0],'The same file with the column again changes nothing');
run=await importFile(report(lines,{withDescription:false}));eq(run.result.duplicateCount,7);eq(stored(),after,'A later report without the column never erases references');
// A description corrected in the ERP: the saved references follow the file, still a duplicate.
const corrected=lines.map(l=>l.reference==='INV-5'?{...l,description:'Qut-77'}:l);
run=await importFile(report(corrected));eq([run.result.duplicateCount,run.result.quotationRefsBackfillCount,run.preview.summary.conflictCount],[7,1,0]);eq(stored()['INV-5'].refs,['Qut-77']);
run=await importFile(report(lines));eq(run.result.quotationRefsBackfillCount,1);eq(stored()['INV-5'].refs,[],'and back: a description that names nothing now');
// A changed amount is still a conflict, the description does not hide it.
const changed=await responseJson(await importApi.POST(jsonRequest('/api/sales/import',body(report(lines.map(l=>l.reference==='INV-4'?{...l,total:2000}:l))))));eq(changed.summary.conflictCount,1);
// A new invoice imported with the column carries its references at once.
run=await importFile(report([...lines,{reference:'INV-6',date:'2026-10-25',description:'qut0108 / Qut-108'}]));eq([run.result.importedCount,run.result.quotationLinkedCount],[1,6]);eq(stored()['INV-6'].refs,['Qut-108']);
after=stored();

// The KPI of the finished month 2026-10, as the supervisor reads it.
const month='2026-10';
async function read(actor='sup',status=200){user(actor);return responseJson(await salesApi.GET(new Request('https://test.invalid/api/sales?month='+month+'&kpis=1')),status);}
const person=(data,id)=>data.kpis.people.find(row=>row.member.id===id);
const metric=(data,id)=>person(data,id).metrics.find(row=>row.id==='orders');
let data=await read();
eq([metric(data,'rep').numerator,metric(data,'rep').denominator,metric(data,'rep').score,metric(data,'rep').source],[2,6,33.33,'automatic'],'rep: Qut-101 and Qut-102 converted by description, of six quotations');
eq(person(data,'rep').quotations.map(q=>[q.number,q.converted,q.invoices]).sort(),[['Q-77',false,[]],['Qut-101',true,['INV-1']],['Qut-102',true,['INV-2']],['Qut-103',false,[]],['Qut-106',false,[]],['Qut-107',false,[]]],'Each quotation with the invoices that converted it; a return, another representative\'s invoice and an earlier invoice convert nothing');
eq([metric(data,'rep2').numerator,metric(data,'rep2').denominator,metric(data,'rep2').status],[0,0,'not_applicable'],'rep2 issued no quotation: not applicable (its invoice converts nobody\'s quotation)');
eq([metric(data,'sup').numerator,metric(data,'sup').denominator],[2,6],'The supervisor\'s team is the sum of its representatives');
eq(data.kpis.people.some(row=>row.member.id==='other'),false);eq(data.kpis.people.flatMap(row=>row.quotations).some(q=>q.number==='Qut-500'),false,'Another team\'s quotation never reaches this supervisor');
// A manual link adds its conversion (Q-77 has no ERP number), and a manual link to an invoice already naming the quotation stays one conversion.
async function evidence(memberId){user('admin');return responseJson(await evidenceApi.GET(new Request('https://test.invalid/api/kpi-evidence?'+new URLSearchParams({memberId,month}))));}
const options=await evidence('rep');
eq(options.quotes.map(q=>q.id).includes('q77'),true);const inv1=options.invoices.find(i=>i.reference==='INV-1');ok(inv1,'The ERP invoice can be linked by hand');
const input={collection:{dueCents:null,collectedCents:null,reference:''},history:{complete:false,reference:''},quotationsComplete:false,quotations:[{quoteId:'q77',saleId:'MAN-77'},{quoteId:'q101',saleId:inv1.id}]};
await responseJson(await evidenceApi.POST(jsonRequest('/api/kpi-evidence',{memberId:'rep',month,version:0,requestId:crypto.randomUUID(),salesRevision:options.salesRevision,evidenceRevision:options.evidenceRevision,input})));
data=await read();
eq([metric(data,'rep').numerator,metric(data,'rep').denominator,metric(data,'rep').score],[3,6,50],'Manual link adds Q-77; Qut-101 linked both ways counts once');
eq(person(data,'rep').quotations.filter(q=>q.converted).map(q=>[q.number,q.invoices,q.via]).sort(),[['Q-77',['MAN-77'],['manual']],['Qut-101',['INV-1'],['description','manual']],['Qut-102',['INV-2'],['description']]]);
// An explicit «unconverted» manual row never removes an automatic conversion.
const options2=await evidence('rep');
await responseJson(await evidenceApi.POST(jsonRequest('/api/kpi-evidence',{memberId:'rep',month,version:options2.evidence.version,requestId:crypto.randomUUID(),salesRevision:options2.salesRevision,evidenceRevision:options2.evidenceRevision,input:{...input,quotations:[{quoteId:'q102',saleId:null}]}})));
data=await read();eq([metric(data,'rep').numerator,metric(data,'rep').denominator],[2,6],'A manual row without an invoice leaves Qut-102 converted by its description');
// The manager reads the same numbers; a representative and nobody signed in read nothing.
data=await read('manager');eq([metric(data,'rep').numerator,metric(data,'rep').denominator],[2,6]);
await read('rep',403);await read(null,401);
// The next month: only its own quotation (Qut-105), not converted.
const next=await (async()=>{user('sup');return responseJson(await salesApi.GET(new Request('https://test.invalid/api/sales?month=2026-11&kpis=1')));})();
eq(next.kpis.people.find(p=>p.member.id==='rep').quotations.map(q=>q.number),['Qut-105'],'A quotation belongs to the month of its own day');
eq(sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');sql.close();
console.log(JSON.stringify({ok:true,checks,scope:'Quotation references of «الوصف», the ERP sales report with/without the column, import idempotency and backfill, and the automatic quote-to-sales KPI through real routes on migrated SQLite'}));
