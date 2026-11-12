// «مبيعات مكتب (مستبعد)» for an ERP employee (the owner, 2026-11-12: «ده مبيعات مكتب مش تبع المبيعات», of employee 6007 shown in
// «ربط الموظفين بالمناديب»), without a build:
// - lib/erp-office-employees.ts: the stored list read back (a broken row is empty, each mark once), the keys (marks of direction, spaces,
//   Arabic-Indic digits, case), marks and lifts by number and by name, the row as its own token.
// - lib/erp-quotes.ts planErpQuotes: a marked employee code's quotations excluded with their reason (a quotation imported earlier: «يبقى
//   كما هو»), before a customer or a mapping is needed; lib/erp-collections.ts summarizeCollections: a marked name counted as the office
//   and listed apart.
// - lib/erp-sales-server.ts through POST /api/sales/import on an in-memory SQLite with every migration (the workbook reader replaced by
//   rows given as JSON, as tests/erp-sales-server.mjs does): the choice in the preview excludes the employee's documents (status excluded,
//   counted with the office, never blocking, no category asked), saved with the import (the list, its audit line, the representative
//   mapping removed), shown as saved afterwards; the name rule unchanged; a supervisor reads the mark, cannot lift it, cannot mark an
//   employee of another team's representative; a manager lifts it back to a representative; a document saved earlier for a representative
//   stays saved and is reported; a name mark of the collection statement suggests the mark for an unmapped number of that name; the row
//   changed after the preview refuses the commit (409) and writes nothing.
// Synthetic data only.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {quotation, erpQuotesXls} from '../scripts/lib/erp-quotes-fixture.mjs';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'erp-office-')),seen=new Set();process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const id=globalThis.testIdentity;if(!id)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version,email FROM crm_members WHERE id=?').bind(id).first();return {memberId:m?.id,memberVersion:m?.auth_version,email:m?.email};}`);
fs.writeFileSync(path.join(out,'parser.mjs'),`export class ErpWorkbookError extends Error{};export function parseErpWorkbook(bytes){const rows=JSON.parse(new TextDecoder().decode(bytes));return {rows,categories:[...new Set(rows.map(r=>r.category))],employees:[...new Map(rows.map(r=>[r.employeeId,{employeeId:r.employeeId,employeeName:r.employeeName}])).values()],warnings:[]};}`);
// stub: the sales server's './erp-sales' is the JSON reader above; every other module is the source.
function compile(relative,stub=true){
 const tag=relative+(stub?'':':real');if(seen.has(tag))return;seen.add(tag);
 const src=path.join(root,relative),dest=path.join(out,(stub?'':'real/')+relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});
 let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
  if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));
  if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));
  if(stub&&imp==='./erp-sales'&&relative==='lib/erp-sales-server.ts')return 'from '+JSON.stringify(path.join(out,'parser.mjs'));
  if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
  let rel=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
  if(!/\.tsx?$/.test(rel))rel+=fs.existsSync(path.join(root,rel+'.ts'))?'.ts':'.tsx';
  compile(rel,stub);return 'from '+JSON.stringify(path.join(out,(stub?'':'real/')+rel.replace(/\.tsx?$/,'.mjs')));
 });
 fs.writeFileSync(dest,code);
}
compile('app/api/sales/import/route.ts');compile('lib/erp-office-employees.ts');compile('lib/erp-quotes.ts',false);compile('lib/customer-identity.ts',false);compile('lib/erp-collections.ts',false);
const O=await import(path.join(out,'lib/erp-office-employees.mjs')),Q=await import(path.join(out,'real/lib/erp-quotes.mjs')),I=await import(path.join(out,'real/lib/customer-identity.mjs')),C=await import(path.join(out,'real/lib/erp-collections.mjs'));
let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;},ok=(v,m)=>{assert.ok(v,m);checks++;};

// ---- the list ---------------------------------------------------------------------------------------------------------------------
eq(O.ERP_OFFICE_CHOICE.includes(':'),true,'the choice cannot be a member id (ids have no colon)');
eq([O.parseOfficeList(null),O.parseOfficeList('{'),O.parseOfficeList('[]'),O.parseOfficeList('{"employees":"x"}')].map(l=>l.employees),[[],[],[],[]],'a missing or broken row is an empty list');
eq(O.officeIdKey('‏ ٦٠٠٧ '),'6007','an employee number: marks of direction, spaces and Arabic-Indic digits');
eq(O.officeIdKey('۶۰۰۷'),'6007','Persian digits too');
eq(O.officeNameKey('  نوفل   بكر‏ '),'نوفل بكر','a name: repeated spaces and marks removed');
const parsed=O.parseOfficeList(JSON.stringify({employees:[{employeeId:'6007',employeeName:'نوفل بكر',by:'sm',at:'t'},{employeeId:'٦٠٠٧',employeeName:'مكرر',by:'x',at:'t'},{employeeId:'',employeeName:'سالم  علي',by:'sm',at:'t'},{employeeId:'',employeeName:'سالم علي',by:'x',at:'t'},{},null,'x']}));
eq(parsed.employees.map(e=>[e.employeeId,e.employeeName]),[['6007','نوفل بكر'],['','سالم علي']],'each number once and each name once (the first kept)');
eq([[...O.officeById(parsed).keys()],[...O.officeNameOnly(parsed).keys()],[...O.officeByName(parsed)]],[['6007'],['سالم علي'],[['نوفل بكر','id'],['سالم علي','name']]],'by number, by name only, and every mark by name with where it was made');
let list=O.applyOfficeChanges({employees:[]},{markIds:[{employeeId:' 6007 ',employeeName:'نوفل بكر'}],markNames:['سالم علي']},'sm','2026-11-12T08:00:00.000Z');
eq(list.employees,[{employeeId:'6007',employeeName:'نوفل بكر',by:'sm',at:'2026-11-12T08:00:00.000Z'},{employeeId:'',employeeName:'سالم علي',by:'sm',at:'2026-11-12T08:00:00.000Z'}],'marks: who and when');
eq(O.applyOfficeChanges(list,{markIds:[{employeeId:'٦٠٠٧',employeeName:'آخر'}]},'x','later').employees[0],list.employees[0],'a number marked again keeps its first mark');
eq(O.applyOfficeChanges(list,{unmarkIds:['٦٠٠٧'],unmarkNames:['سالم  علي']},'x','y').employees,[],'lifted by number and by name');
eq(O.parseOfficeList(O.serializeOfficeList(list)),list,'written and read back');
eq(O.officeUnchanged(null),{sql:'(SELECT owner_id FROM crm_settings WHERE id=?) IS ?',args:[O.ERP_OFFICE_SETTING,null]},'the row is its own token (none: NULL)');

// ---- the quotations plan --------------------------------------------------------------------------------------------------------
const customer=(id,code)=>({id,kind:'customer',parentId:null,assignedTo:'rep',branch:'الرئيسي',version:1,createdAt:'',updatedAt:'',data:{name:'عميل '+id,code,region:'الوسطى'}});
const rep={id:'rep',name:'مندوب الوسطى',role:'rep',branch:'الرئيسي',email:'rep@yourrest.org',active:1,target:0};
const records=[customer('c1','101')];
const read=bytes=>Q.parseErpQuotes(Q.readErpQuotesTable(new Uint8Array(bytes)));
const quotes=read(erpQuotesXls([quotation({code:'Qut-1',customerCode:'101',empCode:'6007',empName:'نوفل بكر',lines:[{name:'قالب',qty:1,price:1000}]}),quotation({code:'Qut-2',customerCode:'999',empCode:'٦٠٠٧',empName:'نوفل بكر',lines:[{name:'قالب',qty:1,price:1000}]}),quotation({code:'Qut-3',customerCode:'101',empCode:'7001',lines:[{name:'قالب',qty:1,price:1000}]})].flat()));
const plan=(rows,extra={})=>Q.planErpQuotes({file:quotes,records:rows,visibleIds:new Set(rows.map(r=>r.id)),codes:I.uniqueCustomerCodes(rows),employeeReps:new Map([['7001','rep'],['6007','rep']]),eligible:new Map([['rep',rep]]),customerInRegion:()=>true,importer:{id:'owner',name:'المدير'},now:'2026-11-12T08:00:00.000Z',importId:'erp-quotes-import-1',fileName:'quotes.xls',...extra});
eq((await plan(records)).map(p=>p.status),['new','refused','new'],'without a mark the employee\'s quotations are imported (or refused for their own reason)');
const marked=await plan(records,{officeEmployees:new Set(['6007'])});
eq(marked.map(p=>[p.code,p.status,p.reason,p.data===undefined]),[['Qut-1','excluded',Q.ERP_QUOTE_REASONS.officeMarked,true],['Qut-2','excluded',Q.ERP_QUOTE_REASONS.officeMarked,true],['Qut-3','new',Q.ERP_QUOTE_REASONS.new,false]],'marked: excluded before the customer (Arabic digits too), never written; another employee unchanged');
const first=(await plan(records))[0],storedQuote={id:first.recordId,kind:'quote',parentId:'c1',assignedTo:'rep',branch:'الرئيسي',version:1,createdAt:'',updatedAt:'',data:first.data};
eq((await plan([...records,storedQuote],{officeEmployees:new Set(['6007'])}))[0].reason,Q.ERP_QUOTE_REASONS.officeMarkedSaved,'a quotation imported before the mark: excluded, and it stays as it is');

// ---- the collection statement ----------------------------------------------------------------------------------------------------
const account=(no,rep,due,collected)=>({rowNumber:Number(no),accountNo:no,accountName:'حساب '+no,rep,collector:'',previousDebit:0,previousCredit:0,periodDebit:due,periodCredit:collected,currentDebit:due-collected,currentCredit:0});
const accounts=[account('1','مندوب ألف',1000,500),account('2','نوفل  بكر',300,300),account('3','مبيعات مكتب',50,50),account('4','نوفل بكر',200,0)];
const plain=C.summarizeCollections(accounts);
eq([plain.groups.map(g=>g.name),plain.officeGroups,plain.officeRows],[['مندوب ألف','نوفل بكر'],[],1],'without a mark: a name of its own');
const office=C.summarizeCollections(accounts,new Set(['نوفل بكر']));
eq([office.groups.map(g=>g.name),office.officeGroups.map(g=>[g.name,g.accounts,g.dueCents,g.collectedCents]),office.officeRows,office.officeDueCents,office.officeCollectedCents],[['مندوب ألف'],[['نوفل بكر',2,500,300]],3,550,350],'marked: counted as the office and listed apart');

// ---- the ERP sales import ----------------------------------------------------------------------------------------------------------
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+f,'utf8'));
let race=null;
class Statement{constructor(q,a=[]){this.q=q;this.a=a;}bind(...a){return new Statement(this.q,a);}async run(){const result=sql.prepare(this.q).run(...this.a);return {meta:{changes:Number(result.changes)}};}async all(){return {results:sql.prepare(this.q).all(...this.a)};}async first(){return sql.prepare(this.q).get(...this.a)||null;}}
const DB={prepare:q=>new Statement(q),batch:async statements=>{if(race){const fn=race;race=null;await fn();}sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid',YR_AUTH_SECRET:'a'.repeat(64)};
const member=(id,role,supervisor='sup')=>sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,1,0,?)').run(id,'u-'+id,id+'@yourrest.org',id,role,'الفرع',supervisor,'eastern','2025-01-01');
member('admin','admin','');member('manager','manager','');member('sup','supervisor','manager');member('rep','rep');member('rep2','rep','other-sup');
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-admin')").run();
const api=await import(path.join(out,'app/api/sales/import/route.mjs')),S=await import(path.join(out,'lib/erp-sales-server.mjs'));
const user=id=>{globalThis.testIdentity=id;};
const row=(extra={})=>({rowNumber:10,reference:'INV1',date:'2025-01-15',documentType:'sale',itemCode:'M1',itemName:'قالب',category:'قوالب البلوك المتحركة',quantity:1,unit:'قالب',unitPrice:100,discountCents:0,totalCents:10000,vatCents:1500,customerCode:'C1',customerName:'مصنع أ',employeeId:'1001',employeeName:'أحمد',...extra});
const noufal=(extra={})=>row({employeeId:'6007',employeeName:'نوفل بكر',category:'مواد المكتب',...extra});
const input=(rows,extra={})=>({action:'preview',fileName:'sales.xlsx',base64:Buffer.from(JSON.stringify(rows)).toString('base64'),employeeMappings:[{employeeId:'1001',repId:'rep'}],categoryMappings:[],...extra});
const req=body=>new Request('https://test.invalid/api/sales/import',{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json'},body:JSON.stringify(body)});
async function post(body,status=200){const response=await api.POST(req(body)),json=await response.json();assert.equal(response.status,status,JSON.stringify(json));checks++;return json;}
const commit=(body,preview,status=200)=>post({...body,action:'commit',previewToken:preview.previewToken,requestId:crypto.randomUUID()},status);
const officeRow=()=>sql.prepare("SELECT owner_id FROM crm_settings WHERE id='erp-office-employees'").get()?.owner_id??null;
const count=table=>sql.prepare('SELECT count(*) AS n FROM '+table).get().n;
const OFFICE=O.ERP_OFFICE_CHOICE;

user('manager');
let body=input([row(),noufal({reference:'N1'}),noufal({reference:'N2',totalCents:20000})]),preview=await post(body);
eq([preview.documents.filter(d=>d.employeeId==='6007').map(d=>d.status),preview.categories.includes('مواد المكتب'),preview.summary.unmappedCount],[['unmapped','unmapped'],true,2],'employee 6007 unmapped: his documents ask for a representative');
body=input([row(),noufal({reference:'N1'}),noufal({reference:'N2',totalCents:20000})],{employeeMappings:[{employeeId:'1001',repId:'rep'},{employeeId:'6007',repId:OFFICE}]});preview=await post(body);
const docs=preview.documents.filter(d=>d.employeeId==='6007');
eq(docs.map(d=>[d.status,d.reason,d.repId,d.totalCents]),[['excluded',S.ERP_OFFICE_REASON,'',0],['excluded',S.ERP_OFFICE_REASON,'',0]],'«مبيعات مكتب (مستبعد)» chosen: excluded as office sales, counted for nobody');
eq([preview.summary.newCount,preview.summary.excludedCount,preview.summary.officeExcludedCount,preview.summary.officeMarkedCount,preview.summary.unmappedCount,preview.summary.skippedCount,preview.categories.includes('مواد المكتب')],[1,2,2,2,0,0,false],'never blocking, no category asked for him');
eq(preview.employees.find(e=>e.employeeId==='6007'),{employeeId:'6007',employeeName:'نوفل بكر',repId:OFFICE,mappingSource:'selected',office:true,officeLocked:false},'listed with the choice');
ok(preview.warnings.includes('مستندات الموظفين المحددين «مبيعات مكتب (مستبعد)» مستبعدة ولا تُحتسب لأي مندوب.'),'and said in the notes');
eq(officeRow(),null,'a preview writes nothing');
let saved=await commit(body,preview);
eq([saved.importedCount,saved.excludedCount,saved.officeExcludedCount,saved.officeMarkedCount,saved.officeUnmarkedCount],[1,2,2,1,0],'imported: one sale, his two documents excluded, one mark saved');
eq(O.parseOfficeList(officeRow()).employees.map(e=>[e.employeeId,e.employeeName,e.by]),[['6007','نوفل بكر','manager']],'the mark: the number, the name, who');
eq(sql.prepare("SELECT count(*) AS n FROM crm_erp_sales WHERE employee_id='6007'").get().n,0,'none of his documents is stored');
const audit=sql.prepare("SELECT actor,action,detail FROM crm_audit WHERE record_id='erp-office-employees'").all();
eq([audit.length,audit[0].actor,audit[0].action,JSON.parse(audit[0].detail).marked,JSON.parse(audit[0].detail).source],[1,'manager',O.ERP_OFFICE_AUDIT_ACTION,[{employeeId:'6007',employeeName:'نوفل بكر',priorRepId:''}],'erp-sales-import'],'audited: who marked whom');
let config=await (await api.GET()).json();
ok(config.employeeMappings.some(m=>m.employeeId==='6007'&&m.repId===OFFICE),'the configuration returns the mark as the employee\'s choice');
eq(config.canChangeOffice,true,'a manager may change it');
// The same file with no choice: the saved mark.
body=input([noufal({reference:'N3'})]);preview=await post(body);
eq([preview.documents[0].status,preview.documents[0].reason,preview.employees[0].mappingSource,preview.employees[0].officeLocked],['excluded',S.ERP_OFFICE_REASON,'saved',false],'next file: excluded by the saved mark');
// Arabic digits in the report find the same mark.
preview=await post(input([noufal({reference:'N4',employeeId:'٦٠٠٧'})]));eq(preview.documents[0].status,'excluded','an employee number written in Arabic digits finds the mark');
// The name rule is unchanged.
preview=await post(input([row({reference:'OFF',employeeName:'مبيعات مكتب',employeeId:'7001',category:'x'})]));eq([preview.documents[0].reason,preview.summary.officeExcludedCount,preview.employees],['مبيعات مكتب: مبيعات شركة أخرى مستبعدة تلقائيًا',1,[]],'«مبيعات مكتب» by name: as before, never listed');

// A supervisor reads the mark and may not lift it; may not mark an employee mapped to another team's representative.
user('sup');config=await (await api.GET()).json();
eq([config.employeeMappings.some(m=>m.employeeId==='6007'&&m.repId===OFFICE),config.canChangeOffice],[true,false],'a supervisor reads the mark, cannot change it');
preview=await post(input([noufal({reference:'N5'})],{employeeMappings:[{employeeId:'6007',repId:OFFICE}]}));
eq([preview.documents[0].status,preview.employees[0].officeLocked],['excluded',true],'sending the saved mark back changes nothing; the select is locked for him');
const locked=await post(input([noufal({reference:'N5'})],{employeeMappings:[{employeeId:'6007',repId:'rep'}]}),403);eq(locked.error,S.ERP_OFFICE_LOCKED,'lifting it: refused with its reason');
sql.prepare("INSERT INTO crm_erp_employee_mappings(employee_id,rep_id,updated_by,updated_at) VALUES('2002','rep2','admin','t')").run();
await post(input([row({reference:'X1',employeeId:'2002',employeeName:'خالد'})],{employeeMappings:[{employeeId:'2002',repId:OFFICE}]}),403);
eq(sql.prepare("SELECT rep_id FROM crm_erp_employee_mappings WHERE employee_id='2002'").get().rep_id,'rep2','an employee of another team\'s representative: marking refused');
// A supervisor marks an employee mapped to his own representative (saved with the import, the mapping removed).
sql.prepare("INSERT INTO crm_erp_employee_mappings(employee_id,rep_id,updated_by,updated_at) VALUES('3003','rep','admin','t')").run();
body=input([row({reference:'Y1',employeeId:'3003',employeeName:'سعيد'})],{employeeMappings:[{employeeId:'3003',repId:OFFICE}]});preview=await post(body);
eq(preview.documents[0].status,'excluded','a supervisor marks an employee of his own representative');
await commit(body,preview);
eq([sql.prepare("SELECT count(*) AS n FROM crm_erp_employee_mappings WHERE employee_id='3003'").get().n,O.parseOfficeList(officeRow()).employees.map(e=>e.employeeId)],[0,['3003','6007']],'the mark saved and the representative mapping removed');

// An employee whose sales were imported for a representative, then marked: the stored sale stays, reported.
user('manager');
body=input([row({reference:'K1',employeeId:'4004',employeeName:'كريم'})],{employeeMappings:[{employeeId:'4004',repId:'rep'}]});await commit(body,await post(body));
const storedBefore=sql.prepare("SELECT id,rep_id,total_cents,data FROM crm_erp_sales WHERE employee_id='4004'").all();eq(storedBefore.length,1,'kareem\'s invoice stored for rep');
body=input([row({reference:'K1',employeeId:'4004',employeeName:'كريم'}),row({reference:'K2',employeeId:'4004',employeeName:'كريم'})],{employeeMappings:[{employeeId:'4004',repId:OFFICE}]});preview=await post(body);
eq(preview.documents.map(d=>[d.reference,d.status,d.reason]),[['K1','excluded',S.ERP_OFFICE_SAVED_REASON],['K2','excluded',S.ERP_OFFICE_REASON]],'marked: the saved one says it stays as it is');
eq([preview.summary.officeSavedCount,preview.warnings.some(w=>w.startsWith('مستندات حُفظت سابقًا لمندوب'))],[1,true],'counted and said');
await commit(body,preview);
eq(sql.prepare("SELECT id,rep_id,total_cents,data FROM crm_erp_sales WHERE employee_id='4004'").all(),storedBefore,'the stored sale is neither deleted nor rewritten');
eq(sql.prepare("SELECT count(*) AS n FROM crm_erp_employee_mappings WHERE employee_id='4004'").get().n,0,'his representative mapping removed');
// A manager lifts it back to a representative: saved with that mapping.
body=input([row({reference:'K1',employeeId:'4004',employeeName:'كريم'})],{employeeMappings:[{employeeId:'4004',repId:'rep'}]});preview=await post(body);
eq([preview.documents[0].status,preview.employees[0].repId,preview.employees[0].mappingSource],['duplicate','rep','selected'],'back to the representative: the saved invoice is a duplicate again');
saved=await commit(body,preview);
eq([saved.officeUnmarkedCount,sql.prepare("SELECT rep_id FROM crm_erp_employee_mappings WHERE employee_id='4004'").get()?.rep_id,O.parseOfficeList(officeRow()).employees.some(e=>e.employeeId==='4004')],[1,'rep',false],'the mark lifted, the mapping saved');
ok(JSON.parse(sql.prepare("SELECT detail FROM crm_audit WHERE record_id='erp-office-employees' ORDER BY created_at DESC,rowid DESC LIMIT 1").get().detail).unmarked.some(u=>u.employeeId==='4004'&&u.repId==='rep'),'the lift audited with its representative');

// A name marked in the collection statement suggests the mark for an unmapped number of exactly that name.
const withName=O.applyOfficeChanges(O.parseOfficeList(officeRow()),{markNames:['ماجد  حسن']},'manager','t');
sql.prepare("UPDATE crm_settings SET owner_id=? WHERE id='erp-office-employees'").run(O.serializeOfficeList(withName));
body=input([row({reference:'M1',employeeId:'5005',employeeName:'ماجد حسن'})]);preview=await post(body);
eq([preview.documents[0].status,preview.employees[0].repId,preview.employees[0].mappingSource],['excluded',OFFICE,'name'],'suggested by the name mark of the collection statement');
saved=await commit(body,preview);
eq([saved.officeMarkedCount,O.parseOfficeList(officeRow()).employees.filter(e=>e.employeeName==='ماجد حسن').map(e=>e.employeeId).sort()],[1,['','5005']],'saved as a number mark with the import');

// The row changed after the preview: the commit is refused and writes nothing.
body=input([row({reference:'R1'}),noufal({reference:'R2',employeeId:'8008',employeeName:'جديد'})],{employeeMappings:[{employeeId:'1001',repId:'rep'},{employeeId:'8008',repId:OFFICE}]});preview=await post(body);
const salesBefore=count('crm_erp_sales'),rowBefore=officeRow();
race=()=>sql.prepare("UPDATE crm_settings SET owner_id=? WHERE id='erp-office-employees'").run(O.serializeOfficeList(O.applyOfficeChanges(O.parseOfficeList(rowBefore),{markNames:['آخر']},'admin','t')));
await commit(body,preview,409);
eq([count('crm_erp_sales'),O.parseOfficeList(officeRow()).employees.some(e=>e.employeeId==='8008')],[salesBefore,false],'refused (409): no sale, no mark');
preview=await post(body);saved=await commit(body,preview);eq([saved.importedCount,saved.officeMarkedCount],[1,1],'previewed again, it imports');
{const again=await post(body);eq(again.employees.find(e=>e.employeeId==="8008").mappingSource,"saved","and the mark is saved");}

eq(sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok','database intact');
console.log(JSON.stringify({ok:true,checks,syntheticFixtures:true,productionDataUsed:false}));
