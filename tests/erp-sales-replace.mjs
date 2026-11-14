// «دايمًا كامل» (the owner, 2026-11-14): an ERP sales report uploaded again with corrections replaces what is saved for its period instead
// of being refused, because the ERP invoices file always holds every representative for its period. Without a build, on an in-memory
// SQLite with every migration, through the real POST /api/sales/import (the workbook reader replaced by rows given as JSON, as
// tests/erp-sales-server.mjs and tests/erp-office-employees.mjs do; the real reader is tried over HTTP in tests/erp-sales-replace-http.mjs):
// - an importer who reaches every active representative and sends wholeCompany (the page does): a changed invoice takes the file's
//   content, an invoice whose representative changed moves to the new one, an invoice of the period the file no longer holds is removed,
//   a representative with saved sales in the period and no invoice in the file ends it at zero (shown before the commit), the quotations
//   of «الوصف» are exactly the file's (a report without the column keeps the saved ones), and nothing outside the period, nothing of an
//   inactive representative, no manual sale and no saved copy of an office or employee-less document is touched;
// - the commit needs the explicit agreement, is traced (the import's audit line and the rows as they were), replays without a second
//   write, and refuses a stale preview and a race (another import, a row changed meanwhile, a new active representative) writing nothing;
// - a supervisor, an importer who does not reach every representative, and a caller without the flag import exactly as before (a changed
//   invoice is a conflict, nothing is removed); the manual-sales, mixed-document and future-date conflicts still block.
// Synthetic data only.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'erp-sales-replace-')),seen=new Set();process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const id=globalThis.testIdentity;if(!id)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version,email FROM crm_members WHERE id=?').bind(id).first();return {memberId:m?.id,memberVersion:m?.auth_version,email:m?.email};}`);
// The rows as JSON; a row with a «description» field makes a report with the «الوصف» column (every row then has one).
fs.writeFileSync(path.join(out,'parser.mjs'),`export class ErpWorkbookError extends Error{};export function parseErpWorkbook(bytes){const rows=JSON.parse(new TextDecoder().decode(bytes));const hasDescription=rows.some(r=>typeof r.description==='string');return {rows:rows.map(r=>({description:'',...r})),categories:[...new Set(rows.map(r=>r.category))],employees:[...new Map(rows.map(r=>[r.employeeId,{employeeId:r.employeeId,employeeName:r.employeeName}])).values()],warnings:[],hasDescription};}`);
function compile(relative){
 if(seen.has(relative))return;seen.add(relative);
 const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});
 let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
  if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));
  if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));
  if(imp==='./erp-sales'&&relative==='lib/erp-sales-server.ts')return 'from '+JSON.stringify(path.join(out,'parser.mjs'));
  if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
  let rel=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
  if(!/\.tsx?$/.test(rel))rel+=fs.existsSync(path.join(root,rel+'.ts'))?'.ts':'.tsx';
  compile(rel);return 'from '+JSON.stringify(path.join(out,rel.replace(/\.tsx?$/,'.mjs')));
 });
 fs.writeFileSync(dest,code);
}
compile('app/api/sales/import/route.ts');compile('lib/erp-office-employees.ts');
let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;},ok=(v,m)=>{assert.ok(v,m);checks++;};

const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+f,'utf8'));
let race=null;
class Statement{constructor(q,a=[]){this.q=q;this.a=a;}bind(...a){return new Statement(this.q,a);}async run(){const result=sql.prepare(this.q).run(...this.a);return {meta:{changes:Number(result.changes)}};}async all(){return {results:sql.prepare(this.q).all(...this.a)};}async first(){return sql.prepare(this.q).get(...this.a)||null;}}
const DB={prepare:q=>new Statement(q),batch:async statements=>{if(race){const fn=race;race=null;await fn();}sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid',YR_AUTH_SECRET:'a'.repeat(64)};
const member=(id,role,{supervisor='',region='all',name=id,active=1}={})=>sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,?,0,?)').run(id,'u-'+id,id+'@yourrest.org',name,role,'الفرع',supervisor,region,active,'2025-01-01');
member('admin','admin');member('sm','manager');member('sup','supervisor',{supervisor:'sm'});member('sup2','supervisor',{supervisor:'sm'});
member('rep1','rep',{supervisor:'sup',name:'مندوب ألف'});member('rep2','rep',{supervisor:'sup',name:'مندوب باء'});member('rep3','rep',{supervisor:'sup2',name:'مندوب جيم'});member('gone','rep',{supervisor:'sup2',name:'مندوب سابق'});
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-admin')").run();
const api=await import(path.join(out,'app/api/sales/import/route.mjs')),S=await import(path.join(out,'lib/erp-sales-server.mjs')),O=await import(path.join(out,'lib/erp-office-employees.mjs')),domain=await import(path.join(out,'lib/crm-server.mjs'));
const user=id=>{globalThis.testIdentity=id;};
const A='قوالب البلوك المتحركة';
const line=({ref,date,emp='E1',name='مندوب ألف',total=1000,qty=1,type='sale',category=A,customer='C1',description,item='M1'})=>({rowNumber:1,reference:ref,date,documentType:type,itemCode:item,itemName:'قالب',category,quantity:type==='return'?-Math.abs(qty):qty,unit:'حبة',unitPrice:total/100/Math.abs(qty),discountCents:0,totalCents:type==='return'?-Math.abs(total):total,vatCents:0,customerCode:customer,customerName:'مصنع '+customer,employeeId:emp,employeeName:name,...(description===undefined?{}:{description})});
const mappings=[{employeeId:'E1',repId:'rep1'},{employeeId:'E2',repId:'rep2'},{employeeId:'E3',repId:'rep3'}];
const input=(rows,extra={})=>({action:'preview',fileName:'sales.xlsx',base64:Buffer.from(JSON.stringify(rows)).toString('base64'),employeeMappings:mappings,categoryMappings:[],...extra});
const whole=(rows,extra={})=>input(rows,{wholeCompany:true,...extra});
const req=body=>new Request('https://test.invalid/api/sales/import',{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json'},body:JSON.stringify(body)});
async function post(body,status=200){const response=await api.POST(req(body)),json=await response.json();assert.equal(response.status,status,JSON.stringify(json));checks++;return json;}
const commit=(body,preview,status=200,extra={})=>post({...body,action:'commit',previewToken:preview.previewToken,requestId:crypto.randomUUID(),...extra},status);
const count=(table,where='1=1')=>sql.prepare('SELECT count(*) AS n FROM '+table+' WHERE '+where).get().n;
const sale=reference=>sql.prepare('SELECT * FROM crm_erp_sales WHERE reference=?').get(reference);
const snapshot=()=>sql.prepare('SELECT id,document_key,content_hash,mapped_hash,rep_id,total_cents,data,import_id FROM crm_erp_sales ORDER BY id').all();
const status=(preview,ref)=>preview.documents.find(d=>d.reference===ref)?.status;
const refsOf=reference=>JSON.parse(sale(reference).data).quotationRefs;
const repTotal=(rep,from,to)=>sql.prepare('SELECT COALESCE(SUM(total_cents),0) AS n FROM crm_erp_sales WHERE rep_id=? AND date>=? AND date<=?').get(rep,from,to).n;

// ---- what was saved before: July, an early August file, and an invoice after the corrected period ----------------------------------
user('sm');
let body=input([line({ref:'S-0',date:'2026-07-20',total:900}),line({ref:'S-9',date:'2026-08-20',emp:'E3',name:'مندوب جيم',total:300,customer:'C3'})]);
await commit(body,await post(body));
// The departed representative's invoice, imported while he was active; then he leaves (an inactive representative is no one's to import for).
body=input([line({ref:'G-1',date:'2026-08-08',emp:'E9',name:'مندوب سابق',total:700})],{employeeMappings:[{employeeId:'E9',repId:'gone'}]});
await commit(body,await post(body));sql.prepare("UPDATE crm_members SET active=0 WHERE id='gone'").run();
// A manual (confirmed) sale in the period: never an ERP invoice, never touched.
sql.prepare("INSERT INTO crm_records(id,kind,assigned_to,branch,data,created_at,updated_at) VALUES('factory','customer','rep1','الفرع','{}','2026-08-01','2026-08-01')").run();
sql.prepare("INSERT INTO crm_sales(id,customer_id,rep_id,branch,date,reference,reference_key,data,total_cents,mutation_id,create_fingerprint,created_by,created_at,updated_at) VALUES('manual-1','factory','rep1','الفرع','2026-08-07','MAN-1','MAN-1','{}',5500,'t','t','sm','2026-08-07','2026-08-07')").run();

// ---- the first export: 3 to 15 August, every representative ----------------------------------------------------------------------
const first=[
 line({ref:'A-1',date:'2026-08-03',total:5000,description:'حسب عرض Qut-1'}),line({ref:'A-2',date:'2026-08-10',total:4000,description:'Qut-2'}),line({ref:'A-3',date:'2026-08-15',total:1000,description:''}),
 line({ref:'B-1',date:'2026-08-05',emp:'E2',name:'مندوب باء',total:8000,customer:'C2',description:'Qut-3 و Qut-4'}),line({ref:'B-2',date:'2026-08-12',emp:'E2',name:'مندوب باء',total:2000,customer:'C2',description:''}),
 line({ref:'R-1',date:'2026-08-06',emp:'E2',name:'مندوب باء',total:500,type:'return',customer:'C2',description:''}),
 line({ref:'D-1',date:'2026-08-14',emp:'E3',name:'مندوب جيم',total:6000,customer:'C3',description:'Qut-5'}),
 line({ref:'X-1',date:'2026-08-09',emp:'E2',name:'مندوب باء',total:1200,customer:'C2',category:'مواد أخرى',description:''}),
];
body=whole(first,{categoryMappings:[{category:'مواد أخرى',product:A}]});let preview=await post(body);
eq([preview.summary.newCount,preview.summary.replacedCount,preview.summary.movedCount,preview.summary.removedCount],[8,0,0,0],'the first file: everything new, nothing replaced');
eq([preview.replacement.from,preview.replacement.to,preview.replacement.zeroReps,preview.replacement.keptOutsideCount],['2026-08-03','2026-08-15',[],1],'the period is the file\'s first and last invoice; the departed representative\'s invoice is counted as outside the reach');
ok(preview.warnings.includes(S.ERP_KEPT_OUTSIDE_WARNING),'and said in the notes');
let saved=await commit(body,preview);
eq([saved.importedCount,saved.replacement.replacedCount,saved.replacement.removedCount],[8,0,0],'imported, no agreement needed when nothing saved changes');
eq([refsOf('A-1'),refsOf('B-1'),refsOf('D-1')],[['Qut-1'],['Qut-3','Qut-4'],['Qut-5']],'the quotations of «الوصف» saved');
const august=()=>[repTotal('rep1','2026-08-03','2026-08-15'),repTotal('rep2','2026-08-03','2026-08-15'),repTotal('rep3','2026-08-03','2026-08-15')];
eq(august(),[10000,10700,6000],'saved as exported (a return deducted)');

// ---- the ERP corrects it --------------------------------------------------------------------------------------------------------
// A-1's description names another quotation; A-2 belonged to rep2; B-1 was 7000 and names one quotation; R-1 and D-1 were cancelled
// (rep3 has no invoice left); X-1's only category is excluded now.
const corrected=[
 line({ref:'A-1',date:'2026-08-03',total:5000,description:'Qut-7'}),line({ref:'A-3',date:'2026-08-15',total:1000,description:''}),
 line({ref:'A-2',date:'2026-08-10',emp:'E2',name:'مندوب باء',total:4000,description:'Qut-2'}),
 line({ref:'B-1',date:'2026-08-05',emp:'E2',name:'مندوب باء',total:7000,customer:'C2',description:'Qut-3'}),line({ref:'B-2',date:'2026-08-12',emp:'E2',name:'مندوب باء',total:2000,customer:'C2',description:''}),
 line({ref:'X-1',date:'2026-08-09',emp:'E2',name:'مندوب باء',total:1200,customer:'C2',category:'مواد أخرى',description:''}),
];
const before=snapshot(),importsBefore=count('crm_erp_imports'),revisionBefore=sql.prepare('SELECT revision FROM crm_erp_import_state').get().revision;
body=whole(corrected,{categoryMappings:[{category:'مواد أخرى',product:'exclude'}]});preview=await post(body);
eq(['A-1','A-3','A-2','B-1','B-2','X-1','R-1','D-1'].map(ref=>status(preview,ref)),['duplicate','duplicate','moved','replaced','duplicate','removed','removed','removed'],'unchanged, moved, replaced and removed (an excluded category, two cancelled)');
eq([preview.summary.newCount,preview.summary.duplicateCount,preview.summary.replacedCount,preview.summary.movedCount,preview.summary.removedCount,preview.summary.conflictCount,preview.summary.outOfScopeCount],[0,3,1,1,3,0,0],'the counts');
const doc=ref=>preview.documents.find(d=>d.reference===ref);
eq([doc('A-2').saved,doc('A-2').repId,doc('A-2').totalCents,doc('A-2').reason],[{repId:'rep1',repName:'مندوب ألف',totalCents:4000},'rep2',4000,S.ERP_MOVED_REASON],'the moved invoice: from whom, to whom');
eq([doc('B-1').saved.totalCents,doc('B-1').totalCents,doc('B-1').reason],[8000,7000,S.ERP_REPLACED_REASON],'the replaced invoice: its saved net and the file\'s');
eq([doc('D-1').saved,doc('D-1').reason,doc('D-1').repName,doc('D-1').totalCents,doc('R-1').saved.totalCents],[{repId:'rep3',repName:'مندوب جيم',totalCents:6000},S.ERP_REMOVED_REASON,'مندوب جيم',0,-500],'a cancelled invoice: listed with its saved net');
eq([doc('X-1').reason,doc('X-1').saved.totalCents],[S.ERP_REMOVED_EXCLUDED_REASON,1200],'every category excluded now: its saved copy goes');
eq(preview.replacement.zeroReps,[{repId:'rep3',repName:'مندوب جيم',beforeCount:1,beforeCents:6000}],'rep3, with no invoice in the file, ends the period at zero: shown before the commit');
eq([preview.replacement.periodBeforeCents,preview.replacement.periodAfterCents,preview.replacement.keptOutsideCount],[26700,19000,1],'the period\'s saved net before and after (the departed representative\'s left out)');
ok(preview.documents.every(d=>d.status!=='removed'||!['S-0','S-9','G-1'].includes(d.reference)),'nothing outside the period and nothing of an inactive representative is removed');
eq([preview.summary.quotationLinkedCount,preview.summary.quotationRefsBackfillCount],[3,1],'quotations: A-1, A-2 and B-1 name one; A-1 takes its new number');
eq(snapshot(),before,'a preview writes nothing');
// Without the agreement: refused, nothing written.
eq((await commit(body,preview,409)).error,S.ERP_REPLACE_CONFIRM,'the agreement is asked for');
eq([snapshot(),count('crm_erp_imports'),sql.prepare('SELECT revision FROM crm_erp_import_state').get().revision],[before,importsBefore,revisionBefore],'refused without the agreement (409): nothing written');
const requestId=crypto.randomUUID();
saved=await post({...body,action:'commit',previewToken:preview.previewToken,requestId,replaceExisting:true});
eq([saved.importedCount,saved.duplicateCount,saved.replacement.replacedCount,saved.replacement.movedCount,saved.replacement.removedCount,saved.replacement.zeroReps.map(z=>z.repId),saved.quotationRefsBackfillCount],[0,3,1,1,3,['rep3'],1],'the receipt');
eq(august(),[6000,13000,0],'the corrected file wins everywhere: A-2 moved, B-1 corrected, the cancelled ones gone, nothing counted twice');
eq([sale('A-2').rep_id,sale('A-2').id,sale('A-2').import_id,sale('B-1').total_cents,sale('B-1').id],['rep2',before.find(r=>r.data.includes('Qut-2')).id,'erp-import-'+requestId,7000,'erp-sale-'+before.find(r=>r.data.includes('Qut-3')).document_key],'moved and replaced in place: the same ids, written by this import');
eq([sale('D-1'),sale('R-1'),sale('X-1')],[undefined,undefined,undefined],'removed');
eq([refsOf('A-1'),refsOf('A-2'),refsOf('B-1'),refsOf('A-3')],[['Qut-7'],['Qut-2'],['Qut-3'],[]],'the quotations are exactly the file\'s: Qut-1 and Qut-4 dropped, Qut-7 taken');
eq([sale('S-0').total_cents,sale('S-9').total_cents,sale('G-1').total_cents,count('crm_sales',"id='manual-1'")],[900,300,700,1],'July, the 20th of August, the departed representative\'s invoice and the manual sale untouched');
// Traced: the import's audit line lists every change; the rows as they were sit beside it.
const audit=JSON.parse(sql.prepare('SELECT detail FROM crm_audit WHERE id=?').get('erp-import-'+requestId).detail);
eq(audit.replacementChanges.map(c=>[c.action,c.reference,c.from.repId,c.from.totalCents,c.to?.repId??null,c.to?.totalCents??null,c.why??null]).sort((a,b)=>a[1].localeCompare(b[1])),[['moved','A-2','rep1',4000,'rep2',4000,null],['replaced','B-1','rep2',8000,'rep2',7000,null],['removed','D-1','rep3',6000,null,null,'not_in_file'],['removed','R-1','rep2',-500,null,null,'not_in_file'],['removed','X-1','rep2',1200,null,null,'categories_excluded']],'the audit line: what, from whom and how much, to whom and how much');
eq([audit.replacement.from,audit.replacement.to,audit.replacement.zeroReps.length],['2026-08-03','2026-08-15',1],'with the period and the zero rows');
const beforeImages=sql.prepare('SELECT action,record_id,detail FROM crm_audit WHERE id=?').get('erp-import-'+requestId+':replaced');
eq([beforeImages.action,beforeImages.record_id,JSON.parse(beforeImages.detail).before.map(r=>[r.reference,r.rep_id,r.total_cents]).sort((a,b)=>a[0].localeCompare(b[0]))],[S.ERP_REPLACE_AUDIT_ACTION,'erp-import-'+requestId,[['A-2','rep1',4000],['B-1','rep2',8000],['D-1','rep3',6000],['R-1','rep2',-500],['X-1','rep2',1200]]],'the rows as they were, beside it');
ok(JSON.parse(beforeImages.detail).before.every(r=>typeof r.data==='string'&&r.content_hash),'with their whole content');
eq(JSON.parse(sql.prepare('SELECT result FROM crm_erp_imports WHERE id=?').get('erp-import-'+requestId).result).replacement.removedCount,3,'the import\'s row keeps the summary');
// The same request again (a lost answer): the saved receipt, nothing written twice.
const afterCommit=snapshot();
const replayed=await post({...body,action:'commit',previewToken:preview.previewToken,requestId,replaceExisting:true});
eq([replayed.alreadySaved,replayed.replacement.removedCount,snapshot(),count('crm_audit',"id LIKE 'erp-import-"+requestId+"%'")],[true,3,afterCommit,2],'replayed: the same receipt, no second write');
// The same corrected file again: everything unchanged now.
preview=await post(body);
eq([preview.summary.duplicateCount,preview.summary.replacedCount,preview.summary.movedCount,preview.summary.removedCount,preview.replacement.zeroReps,preview.documents.find(d=>d.reference==='X-1').status],[5,0,0,0,[],'excluded'],'uploaded again: nothing to replace, no zero row (rep3 holds nothing in the period)');

// ---- a report without «الوصف» replaces the content and keeps the saved quotations -----------------------------------------------
const plain=corrected.map(row=>{const copy={...row};delete copy.description;return copy;});plain[3]={...plain[3],totalCents:7100};
body=whole(plain,{categoryMappings:[{category:'مواد أخرى',product:'exclude'}]});preview=await post(body);
eq([status(preview,'B-1'),preview.summary.quotationLinkedCount],['replaced',undefined],'B-1 changed again in a report without the column');
await commit(body,preview,200,{replaceExisting:true});
eq([sale('B-1').total_cents,refsOf('B-1'),refsOf('A-1')],[7100,['Qut-3'],['Qut-7']],'its saved quotations kept, the others untouched');

// ---- stale previews and races write nothing ---------------------------------------------------------------------------------------
const staleRows=[...corrected.slice(0,5).map(r=>({...r})),line({ref:'N-1',date:'2026-08-11',emp:'E3',name:'مندوب جيم',total:250,customer:'C3',description:''})];
staleRows[3]={...staleRows[3],totalCents:6900};
body=whole(staleRows,{categoryMappings:[{category:'مواد أخرى',product:'exclude'}]});preview=await post(body);
eq([status(preview,'B-1'),status(preview,'N-1'),status(preview,'X-1')],['replaced','new',undefined],'a preview that replaces B-1');
// Another import commits between the preview and the commit: the old preview is refused.
let other=input([line({ref:'SEP-1',date:'2026-09-02',total:100})]);await commit(other,await post(other));
let held=snapshot();
eq((await commit(body,preview,409,{replaceExisting:true})).error,'انتهت المعاينة أو تغيّرت الصلاحيات أو الربط؛ اعرض الملف مرة أخرى','the stale preview is refused by its signed snapshot');
eq(snapshot(),held,'stale preview (another import meanwhile): refused, nothing replaced');
// A row changed between the commit's check and its write (without the revision moving): the whole batch is a no-op.
preview=await post(body);held=snapshot();const importsHeld=count('crm_erp_imports');
race=()=>sql.prepare("UPDATE crm_erp_sales SET mapped_hash='changed-meanwhile' WHERE reference='B-1'").run();
const raceRefusal='تغيّرت الصلاحيات أو الربط أثناء الحفظ؛ اعرض الملف مرة أخرى';
eq((await commit(body,preview,409,{replaceExisting:true})).error,raceRefusal,'refused at the write\'s own gate');
eq([count('crm_erp_imports'),sql.prepare("SELECT total_cents FROM crm_erp_sales WHERE reference='B-1'").get().total_cents,count('crm_erp_sales',"reference='N-1'")],[importsHeld,7100,0],'a row changed meanwhile: refused (409), nothing written');
sql.prepare("UPDATE crm_erp_sales SET mapped_hash=? WHERE reference='B-1'").run(held.find(r=>r.data.includes('Qut-3')).mapped_hash);
// A representative activated between the check and the write: the importer may no longer reach everyone.
preview=await post(body);
race=()=>member('newcomer','rep',{supervisor:'sup'});
eq((await commit(body,preview,409,{replaceExisting:true})).error,raceRefusal,'refused at the write\'s own gate');
eq([count('crm_erp_sales',"reference='N-1'"),sale('B-1').total_cents],[0,7100],'a new active representative meanwhile: refused, nothing written');
sql.prepare("DELETE FROM crm_members WHERE id='newcomer'").run();
// A tampered token, or another file under the old token.
preview=await post(body);
await commit(body,{previewToken:preview.previewToken.slice(0,-1)+(preview.previewToken.endsWith('0')?'1':'0')},409,{replaceExisting:true});
await commit({...body,base64:Buffer.from(JSON.stringify(corrected)).toString('base64')},preview,409,{replaceExisting:true});
// The commit must carry the flag its preview had.
eq((await commit({...body,wholeCompany:false},preview,409,{replaceExisting:true})).error,'تغير الملف أو اختيارات الربط؛ اعرضه مرة أخرى','a commit without its preview\'s flag is refused');
saved=await commit(body,preview,200,{replaceExisting:true});
eq([saved.importedCount,saved.replacement.replacedCount,sale('B-1').total_cents,sale('N-1').rep_id],[1,1,6900,'rep3'],'previewed again after the races: it imports');

// ---- what the replacement leaves alone -------------------------------------------------------------------------------------------
// The conflicts that block stay blocking: a manual sale of the same number, a mixed document, a future date.
const base=[...staleRows];
for(const [label,extra] of [
 ['the manual sale of the same number',[line({ref:'MAN-1',date:'2026-08-07',total:5500,description:''})]],
 ['a mixed document',[line({ref:'MIX-1',date:'2026-08-08',description:''}),line({ref:'MIX-1',date:'2026-08-08',emp:'E2',name:'مندوب باء',item:'M2',description:''})]],
 ['a future date',[line({ref:'FUT-1',date:'2099-01-01',description:''})]],
]){
 body=whole([...base,...extra]);preview=await post(body);
 eq([preview.summary.conflictCount>0,preview.documents.filter(d=>d.status==='conflict').length>0],[true,true],label+': still a conflict');
 held=snapshot();await commit(body,preview,409,{replaceExisting:true});eq(snapshot(),held,label+': blocks the commit, nothing replaced');
}
// A saved invoice whose employee is now marked «مبيعات مكتب (مستبعد)», and one the ERP now gives without an employee: their saved copies
// stay for their representative (the file still holds them), said in the notes; neither is replaced nor removed.
body=whole([...base,line({ref:'OF-1',date:'2026-08-13',emp:'E4',name:'موظف المكتب',total:800,description:''}),line({ref:'UN-1',date:'2026-08-13',emp:'E1',name:'مندوب ألف',total:600,description:''})],{employeeMappings:[...mappings,{employeeId:'E4',repId:'rep1'}]});
preview=await post(body);await commit(body,preview,200,{replaceExisting:true});
held=snapshot();
body=whole([...base,line({ref:'OF-1',date:'2026-08-13',emp:'E4',name:'موظف المكتب',total:800,description:''}),line({ref:'UN-1',date:'2026-08-13',emp:'',name:'',total:600,description:''})],{employeeMappings:[...mappings,{employeeId:'E4',repId:O.ERP_OFFICE_CHOICE}]});
preview=await post(body);
eq([status(preview,'OF-1'),doc('OF-1').reason,status(preview,'UN-1'),preview.summary.removedCount],['excluded',S.ERP_OFFICE_SAVED_REASON,'unassigned',0],'office-marked and employee-less: excluded and skipped as before, nothing removed');
ok(preview.warnings.includes(S.ERP_OFFICE_SAVED_REPLACE_WARNING)&&preview.warnings.includes(S.ERP_UNASSIGNED_SAVED_WARNING)&&!preview.warnings.includes(S.ERP_OFFICE_SAVED_WARNING),'the notes say both stay as they are');
await commit(body,preview);
eq([sale('OF-1').rep_id,sale('OF-1').total_cents,sale('UN-1').rep_id,snapshot().length],['rep1',800,'rep1',held.length],'both saved copies stay for their representative');
// «مبيعات مكتب» by the employee's name for an invoice saved for a representative: the file still holds it, so its copy stays too.
body=whole([...base,line({ref:'OF-1',date:'2026-08-13',emp:'7001',name:'مبيعات مكتب',total:800,description:''}),line({ref:'UN-1',date:'2026-08-13',emp:'E1',name:'مندوب ألف',total:600,description:''})],{employeeMappings:[...mappings,{employeeId:'E4',repId:O.ERP_OFFICE_CHOICE}]});
preview=await post(body);
eq([status(preview,'OF-1'),preview.summary.removedCount],['excluded',0],'office by name: excluded, its saved copy not taken for a cancelled invoice');

// ---- a supervisor, an importer short of everyone, a caller without the flag: exactly as before ------------------------------------
const changed=[...base.map(r=>({...r})),line({ref:'OF-1',date:'2026-08-13',emp:'E4',name:'موظف المكتب',total:800,description:''}),line({ref:'UN-1',date:'2026-08-13',emp:'E1',name:'مندوب ألف',total:600,description:''})];
changed[3]={...changed[3],totalCents:6500};// B-1 changed again
const withoutA3=changed.filter(r=>r.reference!=='A-3');// A-3 left out
user('sup');
body=whole(withoutA3,{employeeMappings:[{employeeId:'E1',repId:'rep1'},{employeeId:'E2',repId:'rep2'}]});preview=await post(body);
eq([status(preview,'B-1'),preview.documents.find(d=>d.reference==='B-1').reason,status(preview,'A-3'),'replacement' in preview,'replacedCount' in preview.summary],['conflict','رقم المستند محفوظ بمحتوى أو ربط مختلف؛ لن يتم استبداله',undefined,false,false],'a supervisor: the changed invoice is a conflict, nothing to remove, no replacement in the answer');
held=snapshot();await commit(body,preview,409,{replaceExisting:true});eq(snapshot(),held,'and the conflict blocks');
ok(preview.warnings.every(w=>w!==S.ERP_OFFICE_SAVED_REPLACE_WARNING),'the supervisor\'s notes as before');
// A supervisor's file that changes nothing saved: imported, the invoices it leaves out kept.
body=whole([line({ref:'SUP-1',date:'2026-08-04',total:111,description:''})],{employeeMappings:[{employeeId:'E1',repId:'rep1'}]});
saved=await commit(body,await post(body));eq([saved.importedCount,'replacement' in saved,snapshot().length],[1,false,held.length+1],'a supervisor\'s partial file removes nothing');
user('admin');
body=input(withoutA3,{employeeMappings:[...mappings,{employeeId:'E4',repId:O.ERP_OFFICE_CHOICE}]});preview=await post(body);
eq([status(preview,'B-1'),'replacement' in preview],['conflict',false],'without the flag (another caller, an older page): exactly as before');
// A regional manager who does not reach the western representative.
member('west','rep',{supervisor:'sm',region:'western',name:'مندوب الغربية'});member('east-manager','manager',{region:'eastern'});
for(const id of ['rep1','rep2','rep3'])sql.prepare("UPDATE crm_members SET region_scope='eastern' WHERE id=?").run(id);
user('east-manager');
body=whole(withoutA3,{employeeMappings:[...mappings,{employeeId:'E4',repId:O.ERP_OFFICE_CHOICE}]});preview=await post(body);
eq(['replacement' in preview,status(preview,'B-1')!=='replaced'],[false,true],'an importer short of a representative: no replacement');
for(const id of ['rep1','rep2','rep3'])sql.prepare("UPDATE crm_members SET region_scope='all' WHERE id=?").run(id);
sql.prepare("DELETE FROM crm_members WHERE id IN ('west','east-manager')").run();

// ---- the sales the KPIs read follow the replacement -----------------------------------------------------------------------------
user('sm');const context=await domain.context();
const augustSales=await S.readErpSales(context,'2026-08');
eq([augustSales.filter(s=>s.repId==='rep3').map(s=>s.reference).sort(),augustSales.some(s=>s.reference==='D-1'),augustSales.filter(s=>s.reference==='A-2').map(s=>s.repId)],[['N-1','S-9'],false,['rep2']],'readErpSales: the moved invoice under its new representative, the removed ones gone');
eq(sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok','database intact');eq(sql.prepare('PRAGMA foreign_key_check').all(),[],'foreign keys hold');
console.log(JSON.stringify({ok:true,checks,syntheticFixtures:true,productionDataUsed:false}));
