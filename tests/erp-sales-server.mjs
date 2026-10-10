import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
// Backend domain/SQL tests isolate the workbook parser (tested separately against real XLSX).
const root=process.cwd(),runtime=path.join(root,'.sites-runtime');fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'erp-sales-server-')),seen=new Set();process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const id=globalThis.testIdentity;if(!id)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version,email FROM crm_members WHERE id=?').bind(id).first();return {memberId:m?.id,memberVersion:m?.auth_version,email:m?.email};}`);
fs.writeFileSync(path.join(out,'parser.mjs'),`export class ErpWorkbookError extends Error{};export function parseErpWorkbook(bytes){const rows=JSON.parse(new TextDecoder().decode(bytes));return {rows,categories:[...new Set(rows.map(r=>r.category))],employees:[...new Map(rows.map(r=>[r.employeeId,{employeeId:r.employeeId,employeeName:r.employeeName}])).values()],warnings:[]};}`);
function compile(relative){if(seen.has(relative))return;seen.add(relative);const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));if(imp==='./erp-sales')return 'from '+JSON.stringify(path.join(out,'parser.mjs'));if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;let rel=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));if(!/\.tsx?$/.test(rel))rel+=fs.existsSync(path.join(root,rel+'.ts'))?'.ts':'.tsx';compile(rel);return 'from '+JSON.stringify(path.join(out,rel.replace(/\.tsx?$/,'.mjs')));});fs.writeFileSync(dest,code);}
compile('app/api/sales/import/route.ts');compile('app/api/sales/route.ts');compile('lib/erp-sales-server.ts');
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+f,'utf8'));
let race=null,auditFailure=false;
class Statement{constructor(q,a=[],database=sql){this.q=q;this.a=a;this.database=database;}bind(...a){return new Statement(this.q,a,this.database);}async run(){if(auditFailure&&this.q.startsWith('INSERT INTO crm_audit'))throw Error('simulated audit failure');const result=this.database.prepare(this.q).run(...this.a);return {meta:{changes:Number(result.changes)}};}async all(){return {results:this.database.prepare(this.q).all(...this.a)};}async first(){return this.database.prepare(this.q).get(...this.a)||null;}}
const DB={prepare:q=>new Statement(q),batch:async statements=>{if(race){const fn=race;race=null;await fn();}sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid',YR_AUTH_SECRET:'a'.repeat(64)};
const member=(id,role,region='eastern',supervisor='sup')=>sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,1,0,?)').run(id,'u-'+id,id+'@yourrest.org',id,role,'الفرع',supervisor,region,'2025-01-01');
member('admin','admin','all','');member('manager','manager','eastern','');member('sup','supervisor','eastern','manager');member('rep','rep');member('rep2','rep','eastern','other-sup');member('west','rep','western','sup');member('service','customer_service');
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-admin')").run();
const api=await import(path.join(out,'app/api/sales/import/route.mjs')),server=await import(path.join(out,'lib/erp-sales-server.mjs')),domain=await import(path.join(out,'lib/crm-server.mjs'));
let checks=0;const check=(a,b)=>{assert.deepEqual(a,b);checks++;};const user=id=>{globalThis.testIdentity=id;};
const row=(extra={})=>({rowNumber:10,reference:'INV1',date:'2025-01-15',documentType:'sale',itemCode:'M1',itemName:'قالب جديد',category:'قوالب البلوك المتحركة',quantity:3,unit:'قالب',unitPrice:100,discountCents:0,totalCents:30000,vatCents:4500,customerCode:'C1',customerName:'مصنع أ',employeeId:'1001',employeeName:'أحمد',...extra});
const input=(rows,extra={})=>({action:'preview',fileName:'sales.xlsx',base64:Buffer.from(JSON.stringify(rows)).toString('base64'),employeeMappings:[],categoryMappings:[],...extra});
const req=body=>new Request('https://test.invalid/api/sales/import',{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json'},body:JSON.stringify(body)});
async function post(body,status=200){const response=await api.POST(req(body)),json=await response.json();assert.equal(response.status,status,JSON.stringify(json));checks++;return json;}
async function commit(body,preview,extra={},status=200){return post({...body,action:'commit',previewToken:preview.previewToken,requestId:crypto.randomUUID(),...extra},status);}
function count(table){return sql.prepare('SELECT count(*) AS n FROM '+table).get().n;}
user('rep');check((await api.GET()).status,403);await post(input([row()]),403);user('service');check((await api.GET()).status,403);user(null);check((await api.GET()).status,401);
user('sup');let config=await (await api.GET()).json();check(config.members.map(m=>m.id).sort(),['rep']);
await post(input([row()],{employeeMappings:[{employeeId:'1001',repId:'west'}]}),403);await post(input([row()],{employeeMappings:[{employeeId:'1001',repId:'rep2'}]}),403);
let body=input([row(),row({rowNumber:11,itemCode:'M2',quantity:2,totalCents:15000})],{employeeMappings:[{employeeId:'1001',repId:'rep'}]});let preview=await post(body);check(preview.documents.length,1);check(preview.documents[0].lineCount,2);check(preview.summary.totalCents,45000);check(preview.summary.months,['2025-01']);check(count('crm_erp_sales'),0);
const requestId=crypto.randomUUID();const saved=await commit(body,preview,{requestId});check(saved.importedCount,1);check(saved.totalCents,45000);check(count('crm_erp_sales'),1);check((await commit(body,preview,{requestId})).alreadySaved,true);check(count('crm_erp_sales'),1);
await commit({...body,fileName:'changed.xlsx'},preview,{requestId},409);
config=await (await api.GET()).json();check(config.employeeMappings,[{employeeId:'1001',repId:'rep'}]);check(config.categoryMappings,[{category:'قوالب البلوك المتحركة',product:'قوالب البلوك المتحركة'}]);
const raw=sql.prepare('SELECT * FROM crm_erp_sales').get();check(raw.rep_id,'rep');check(raw.region_scope,'eastern');check(JSON.parse(raw.data).items.reduce((n,i)=>n+i.quantity,0),5);check(count('crm_sales'),0);check(count('crm_records'),0);
body=input([row({rowNumber:100,itemCode:'M2',quantity:2,totalCents:15000}),row({rowNumber:101})]);preview=await post(body);check(preview.summary.duplicateCount,1);check((await commit(body,preview)).importedCount,0);check(count('crm_erp_sales'),1);
body=input([row({totalCents:31000})]);preview=await post(body);check(preview.summary.conflictCount,1);await commit(body,preview,{},409);check(count('crm_erp_sales'),1);
body=input([row({reference:'RET1',date:'2025-02-15',documentType:'return',quantity:-2,totalCents:-20000,vatCents:-3000})]);preview=await post(body);check(preview.summary.totalCents,-20000);check(preview.summary.months,['2025-02']);await commit(body,preview);check(JSON.parse(sql.prepare("SELECT data FROM crm_erp_sales WHERE reference='RET1'").get().data).items[0].quantity,-2);
body=input([row({reference:'OFF',employeeName:'  مبيعات   مكتب ',employeeId:'7001',category:'حديد'}),row({reference:'OFF2',employeeName:'مبيعات المكتب',employeeId:'1001'})]);preview=await post(body);check(preview.summary.officeExcludedCount,2);check(preview.summary.unmappedCount,0);check(preview.employees,[]);check(preview.categories,[]);await commit(body,preview);check(count('crm_erp_sales'),2);
body=input([row({reference:'STEEL',category:'حديد'})]);preview=await post(body);check(preview.documents[0].status,'unmapped');body.categoryMappings=[{category:'حديد',product:'قطع غيار المكائن المتحركة'}];preview=await post(body);check(preview.documents[0].status,'new');await commit(body,preview);
body=input([row({reference:'BLANK',employeeName:'',employeeId:''}),row({reference:'GOOD'})]);preview=await post(body);check(preview.summary.skippedCount,0);check(preview.summary.unassignedCount,1);check(preview.summary.unassignedTotalCents,30000);check(preview.summary.newCount,1);const skipped=await commit(body,preview);check(skipped.skippedCount,0);check(skipped.unassignedCount,1);check(skipped.unassignedTotalCents,30000);check(skipped.importedCount,1);check(sql.prepare("SELECT count(*) AS n FROM crm_erp_sales WHERE reference='BLANK'").get().n,0);
body=input([row({reference:'EXCL',category:'مواد أخرى'})],{categoryMappings:[{category:'مواد أخرى',product:'exclude'}]});preview=await post(body);check(preview.summary.excludedCount,1);check(preview.summary.newCount,0);
body=input([row({reference:'MIX'}),row({reference:'MIX',employeeId:'1002'})]);preview=await post(body);check(preview.documents[0].status,'conflict');await commit(body,preview,{},409);
body=input([row({reference:'FUTURE',date:'2099-01-01'})]);preview=await post(body);check(preview.documents[0].status,'conflict');
body=input([row({reference:'TAMPER'})]);preview=await post(body);await commit(body,{previewToken:preview.previewToken.slice(0,-1)+'x'},{},409);await commit(input([row({reference:'TAMPER',totalCents:999})]),preview,{},409);
body=input([row({reference:'STALE'})]);preview=await post(body);const other=input([row({reference:'OTHER'})]);await commit(other,await post(other));await commit(body,preview,{},409);
body=input([row({reference:'DEMOTE'})]);preview=await post(body);const before=count('crm_erp_sales'),importsBefore=count('crm_erp_imports');race=()=>sql.prepare("UPDATE crm_members SET role='rep' WHERE id='sup'").run();await commit(body,preview,{},409);check(count('crm_erp_sales'),before);check(count('crm_erp_imports'),importsBefore);sql.prepare("UPDATE crm_members SET role='supervisor' WHERE id='sup'").run();
body=input([row({reference:'TRANSFER'})]);preview=await post(body);race=()=>sql.prepare("UPDATE crm_members SET supervisor_id='other-sup' WHERE id='rep'").run();await commit(body,preview,{},409);check(count('crm_erp_sales'),before);sql.prepare("UPDATE crm_members SET supervisor_id='sup' WHERE id='rep'").run();
body=input([row({reference:'REGION'})]);preview=await post(body);race=()=>sql.prepare("UPDATE crm_members SET region_scope='western' WHERE id='rep'").run();await commit(body,preview,{},409);check(count('crm_erp_sales'),before);sql.prepare("UPDATE crm_members SET region_scope='eastern' WHERE id='rep'").run();
body=input([row({reference:'ATOMIC1'}),row({reference:'ATOMIC2',employeeId:'1003',employeeName:'خالد'})],{employeeMappings:[{employeeId:'1003',repId:'rep'}]});preview=await post(body);const revision=sql.prepare('SELECT revision FROM crm_erp_import_state').get().revision;auditFailure=true;const logger=console.error;console.error=()=>{};await commit(body,preview,{},500);console.error=logger;auditFailure=false;check(count('crm_erp_sales'),before);check(sql.prepare('SELECT revision FROM crm_erp_import_state').get().revision,revision);check(sql.prepare("SELECT * FROM crm_erp_employee_mappings WHERE employee_id='1003'").get(),undefined);await commit(body,preview);check(count('crm_erp_sales'),before+2);
user('manager');let c=await domain.context();let all=await server.readErpSales(c,'2025-01');check(all.every(s=>s.source==='erp'),true);check(all.some(s=>s.reference==='GOOD'),true);await assert.rejects(server.readOwnErpSales(c,'2025-01'));checks++;
user('rep');c=await domain.context();let own=await server.readOwnErpSales(c,'2025-02');check(own,[{items:[{product:'قوالب البلوك المتحركة',quantity:-2}]}]);check(Object.keys(own[0]),['items']);await assert.rejects(server.readErpSales(c,'2025-01'));checks++;
user('west');c=await domain.context();check(await server.readOwnErpSales(c,'2025-01'),[]);user('manager');sql.prepare("UPDATE crm_members SET region_scope='western' WHERE id='manager'").run();check(await server.readErpSales(await domain.context(),'2025-01'),[]);
user('sup');sql.prepare("UPDATE crm_members SET supervisor_id='other-sup' WHERE id='rep'").run();check(await server.readErpSales(await domain.context(),'2025-01'),[]);preview=await post(input([row({reference:'OUTSIDE'})]));check(preview.documents[0].status,'out_of_scope');check(preview.documents[0].repId,'');sql.prepare("UPDATE crm_members SET supervisor_id='sup' WHERE id='rep'").run();
await post({...input([row()]),base64:'!!!!'},400);await post({...input([row()]),employeeMappings:[{employeeId:'1001',repId:'rep'},{employeeId:'1001',repId:'rep'}]},400);
// Manual invoices cannot be counted again through ERP, including races after preview.
sql.prepare("INSERT INTO crm_records(id,kind,assigned_to,branch,data,created_at,updated_at) VALUES('manual-factory','customer','rep','الفرع','{}','2025-01-01','2025-01-01')").run();
const manual=(reference)=>sql.prepare("INSERT INTO crm_sales(id,customer_id,rep_id,branch,date,reference,reference_key,data,total_cents,mutation_id,create_fingerprint,created_by,created_at,updated_at) VALUES(?, 'manual-factory','rep','الفرع','2025-01-15',?,?,'{}',10000,'test','test','sup','2025-01-15','2025-01-15')").run('manual-'+reference,reference,reference.toUpperCase());
manual('MANUAL-1');body=input([row({reference:'MANUAL-1'})]);preview=await post(body);check(preview.summary.conflictCount,1);await commit(body,preview,{},409);check(sql.prepare("SELECT count(*) AS n FROM crm_erp_sales WHERE reference='MANUAL-1'").get().n,0);
body=input([row({reference:'MANUAL-RACE'})]);preview=await post(body);const beforeManualRace=count('crm_erp_sales');race=()=>manual('MANUAL-RACE');await commit(body,preview,{},409);check(count('crm_erp_sales'),beforeManualRace);
sql.prepare("DELETE FROM crm_sales WHERE id LIKE 'manual-%'").run();
// An explicitly excluded category is remembered even when the whole document is excluded.
body=input([row({reference:'EXCLUDED-MAPPING',category:'مستبعد'})],{categoryMappings:[{category:'مستبعد',product:'exclude'}]});preview=await post(body);await commit(body,preview);check(sql.prepare("SELECT product FROM crm_erp_category_mappings WHERE category='مستبعد'").get().product,'exclude');
// Office rows are removed before invoice grouping, even when numbers collide.
body=input([row({reference:'OFFICE-COLLISION'}),row({reference:'OFFICE-COLLISION',employeeName:'مبيعات مكتب',employeeId:'7001',customerName:'شركة أخرى',category:'حديد'})]);preview=await post(body);check(preview.summary.officeExcludedCount,1);check(preview.summary.newCount,1);check(preview.summary.conflictCount,0);await commit(body,preview);check(sql.prepare("SELECT total_cents FROM crm_erp_sales WHERE reference='OFFICE-COLLISION'").get().total_cents,30000);
// Supervisors cannot rewrite a company-wide category mapping that another import saved.
body=input([row({reference:'CATEGORY-CHANGE'})],{categoryMappings:[{category:'قوالب البلوك المتحركة',product:'خدمات صيانة'}]});await post(body,403);check(sql.prepare("SELECT product FROM crm_erp_category_mappings WHERE category='قوالب البلوك المتحركة'").get().product,'قوالب البلوك المتحركة');
user('admin');preview=await post(body);check(preview.summary.newCount,1);await commit(body,preview);check(sql.prepare("SELECT product FROM crm_erp_category_mappings WHERE category='قوالب البلوك المتحركة'").get().product,'خدمات صيانة');
// Remapping checks both former and new employee owners at the transaction boundary.
user('sup');member('replacement','rep');body=input([row({reference:'REMAP-RACE'})],{employeeMappings:[{employeeId:'1001',repId:'replacement'}]});preview=await post(body);race=()=>sql.prepare("UPDATE crm_members SET supervisor_id='other-sup' WHERE id='rep'").run();await commit(body,preview,{},409);check(sql.prepare("SELECT rep_id FROM crm_erp_employee_mappings WHERE employee_id='1001'").get().rep_id,'rep');check(sql.prepare("SELECT count(*) AS n FROM crm_erp_sales WHERE reference='REMAP-RACE'").get().n,0);sql.prepare("UPDATE crm_members SET supervisor_id='sup' WHERE id='rep'").run();
await post(input([row()],{employeeMappings:[{employeeId:'1001',repId:'sup'}]}),403);
check(sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');check(count('crm_sales'),0);
// End-to-end: actual supplied XLSX bytes -> authenticated import -> SQLite facts -> month reports.
const parserActual=path.join(out,'parser-actual.mjs');fs.writeFileSync(parserActual,ts.transpileModule(fs.readFileSync(path.join(root,'lib/erp-sales.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
const serverRealPath=path.join(out,'lib/erp-sales-real.mjs');fs.writeFileSync(serverRealPath,fs.readFileSync(path.join(out,'lib/erp-sales-server.mjs'),'utf8').replaceAll(path.join(out,'parser.mjs'),parserActual));
const serverReal=await import(serverRealPath),parserReal=await import(parserActual);
const fixture=process.env.ERP_TEST_WORKBOOK||path.resolve(root,'../../upload/Reports_Invoices_14480422_094904.xlsx');
if(!fs.existsSync(fixture))throw Error('ERP_TEST_WORKBOOK must point to the original ERP fixture');
const workbookBytes=fs.readFileSync(fixture),workbook=parserReal.parseErpWorkbook(workbookBytes),eligibleRows=workbook.rows.filter(r=>!parserReal.isOfficeEmployee(r.employeeName)&&r.employeeName&&r.employeeId);
const realMappings=[...new Set(eligibleRows.map(r=>r.employeeId))].map((employeeId,index)=>({employeeId,repId:'real-rep-'+index}));for(const mapping of realMappings)member(mapping.repId,'rep');
user('admin');const realContext=await domain.context(),realBody={action:'preview',fileName:'actual-erp.xlsx',base64:workbookBytes.toString('base64'),employeeMappings:realMappings,categoryMappings:[...new Set(eligibleRows.map(r=>r.category))].map(category=>({category,product:'قوالب البلوك المتحركة'})),allowSkipped:true};
// Exercise automatic full-name selection through the actual XLSX parser as well.
for(const mapping of realMappings)sql.prepare('UPDATE crm_members SET name=? WHERE id=?').run(eligibleRows.find(r=>r.employeeId===mapping.employeeId).employeeName,mapping.repId);
const realAutoPreview=await serverReal.importErpSales(await domain.context(),{...realBody,employeeMappings:[]});
check(realAutoPreview.summary.autoMatchedCount>0,true);
for(const employee of realAutoPreview.employees.filter(e=>e.mappingSource==='name'))check(employee.repId,realMappings.find(m=>m.employeeId===employee.employeeId).repId);
check(realAutoPreview.summary.officeExcludedCount>0,true);
for(const mapping of realMappings)sql.prepare('UPDATE crm_members SET name=? WHERE id=?').run(mapping.repId,mapping.repId);
await assert.rejects(serverReal.importErpSales(realContext,{...realBody,base64:Buffer.from('not-an-xlsx').toString('base64')}),error=>error.status===400&&!!error.message);checks++;
const realPreview=await serverReal.importErpSales(realContext,realBody);check(realPreview.summary.conflictCount,0);check(realPreview.summary.totalCents,eligibleRows.reduce((n,r)=>n+r.totalCents,0));check(realPreview.summary.months,['2026-09','2026-10']);checks++;
const realCommit=await serverReal.importErpSales(realContext,{...realBody,action:'commit',requestId:crypto.randomUUID(),previewToken:realPreview.previewToken});check(realCommit.importedCount,realPreview.summary.newCount);check(realCommit.skippedCount,realPreview.summary.unmappedCount);check(realCommit.officeExcludedCount,realPreview.summary.officeExcludedCount);
for(const month of realCommit.months){const monthSales=await serverReal.readErpSales(realContext,month);check(monthSales.reduce((n,s)=>n+s.totalCents,0),eligibleRows.filter(r=>r.date.startsWith(month)).reduce((n,r)=>n+r.totalCents,0));}
const realRepeat=await serverReal.importErpSales(realContext,{...realBody,employeeMappings:[],categoryMappings:[]});check(realRepeat.summary.newCount,0);check(realRepeat.summary.duplicateCount,realCommit.importedCount);
// The reverse path also blocks a manual invoice that would duplicate an ERP document.
const manualRoute=await import(path.join(out,'app/api/sales/route.mjs'));
sql.prepare("UPDATE crm_records SET data=? WHERE id='manual-factory'").run(JSON.stringify({name:'Test factory',region:'الشرقية'}));
const manualInput=reference=>({action:'save',createKey:crypto.randomUUID(),data:{customerId:'manual-factory',repId:'rep',date:'2025-01-15',reference,items:[{product:'قوالب البلوك المتحركة',description:'',quantity:1,unitPrice:100}],discount:0,notes:''}});
async function manualPost(body,status=200){const response=await manualRoute.POST(req(body)),json=await response.json();assert.equal(response.status,status,JSON.stringify(json));checks++;return json;}
user('admin');await manualPost(manualInput('INV1'),409);
const manualRaceInput=manualInput('MANUAL-ERP-RACE'),erpRaceKey=await server.erpInvoiceKey(manualRaceInput.data.reference,manualRaceInput.data.date);
race=()=>sql.prepare("INSERT INTO crm_erp_sales(id,document_key,content_hash,mapped_hash,reference,document_type,date,employee_id,rep_id,branch,region_scope,customer_code,customer_name,data,total_cents,import_id,created_by,created_at) SELECT 'erp-race-manual',?,content_hash,mapped_hash,'MANUAL-ERP-RACE',document_type,date,employee_id,rep_id,branch,region_scope,customer_code,customer_name,data,total_cents,import_id,created_by,created_at FROM crm_erp_sales WHERE reference='INV1' LIMIT 1").run(erpRaceKey);
await manualPost(manualRaceInput,409);check(sql.prepare("SELECT count(*) AS n FROM crm_sales WHERE reference='MANUAL-ERP-RACE'").get().n,0);
const manualFresh=manualInput('MANUAL-FRESH');await manualPost(manualFresh);check((await manualPost(manualFresh)).alreadySaved,true);check(sql.prepare("SELECT count(*) AS n FROM crm_sales WHERE reference='MANUAL-FRESH'").get().n,1);
// Name inference remains a preview suggestion until the same import is confirmed.
// Use real SQLite for all identity/transaction races; never touch production data.
const rename=(id,name)=>sql.prepare('UPDATE crm_members SET name=? WHERE id=?').run(name,id);
member('auto-rep','rep');rename('auto-rep','إسلام مصطفى حسين شلبي');
member('auto-other','rep');rename('auto-other','أحمد عبد العزيز محمد');
const autoBody=(reference,employeeName='إسلام مصطفى حسين شلبي',extra={})=>input([row({reference,date:'2024-03-12',employeeId:'employee-'+reference,employeeName})],extra);
const employee=(preview,id)=>preview.employees.find(e=>e.employeeId===id);
user('sup');
body=autoBody('AUTO-NAME','  إسلام\u200f  مصطفى\tحسين شلبي  ');preview=await post(body);
check(preview.summary.autoMatchedCount,1);check(preview.summary.newCount,1);check(preview.documents[0].repId,'auto-rep');
check(employee(preview,'employee-AUTO-NAME').mappingSource,'name');check(employee(preview,'employee-AUTO-NAME').repId,'auto-rep');
check(sql.prepare("SELECT rep_id FROM crm_erp_employee_mappings WHERE employee_id='employee-AUTO-NAME'").get(),undefined);
const autoRequestId=crypto.randomUUID();check((await commit(body,preview,{requestId:autoRequestId})).importedCount,1);
check((await commit(body,preview,{requestId:autoRequestId})).alreadySaved,true);
check(sql.prepare("SELECT rep_id FROM crm_erp_employee_mappings WHERE employee_id='employee-AUTO-NAME'").get().rep_id,'auto-rep');
check(sql.prepare("SELECT rep_id FROM crm_erp_sales WHERE reference='AUTO-NAME'").get().rep_id,'auto-rep');
preview=await post(body);check(preview.summary.duplicateCount,1);check(preview.summary.autoMatchedCount,0);check(employee(preview,'employee-AUTO-NAME').mappingSource,'saved');
// A saved employee ID survives differing names; explicit choices override it.
body=input([row({reference:'AUTO-SAVED-PRIORITY',employeeId:'employee-AUTO-NAME',employeeName:'أحمد عبد العزيز محمد'})]);preview=await post(body);
check(preview.documents[0].repId,'auto-rep');check(preview.employees[0].mappingSource,'saved');
body.employeeMappings=[{employeeId:'employee-AUTO-NAME',repId:'auto-other'}];preview=await post(body);
check(preview.documents[0].repId,'auto-other');check(preview.employees[0].mappingSource,'selected');check(preview.summary.autoMatchedCount,0);
body=autoBody('AUTO-SELECTED',undefined,{employeeMappings:[{employeeId:'employee-AUTO-SELECTED',repId:'auto-other'}]});preview=await post(body);
check(preview.documents[0].repId,'auto-other');check(preview.employees[0].mappingSource,'selected');
// Harmless Unicode/spacing/case variants normalize; partial or different names do not.
rename('auto-other','John Smith');body=autoBody('AUTO-NFKC',' ＪＯＨＮ\u00a0SMITH ');preview=await post(body);
check(preview.documents[0].repId,'auto-other');check(preview.employees[0].mappingSource,'name');
for(const [suffix,name] of [['PARTIAL','إسلام مصطفى'],['PREFIX','إسلام مصطفى حسين شلبي الثاني'],['DIFFERENT','محمد اسم مختلف']]){
 preview=await post(autoBody('AUTO-'+suffix,name));check(preview.documents[0].status,'unmapped');check(preview.documents[0].repId,'');check(preview.summary.autoMatchedCount,0);check(preview.employees[0].mappingSource,'unmapped');
}
body=input([row({reference:'AUTO-BLANK-ID',employeeId:'',employeeName:'إسلام مصطفى حسين شلبي'})]);preview=await post(body);check(preview.documents[0].status,'unassigned');check(preview.documents[0].repId,'');check(preview.summary.autoMatchedCount,0);check(preview.employees,[]);
// Repeated consistent ERP rows infer once. Conflicting/blank/office names with the
// same employee ID must not select whichever name happened to occur last.
body=input([row({reference:'AUTO-REPEAT-1',employeeId:'auto-repeat',employeeName:'إسلام مصطفى حسين شلبي'}),row({reference:'AUTO-REPEAT-2',employeeId:'auto-repeat',employeeName:'إسلام  مصطفى حسين شلبي'})]);preview=await post(body);
check(preview.summary.autoMatchedCount,1);check(preview.documents.every(d=>d.repId==='auto-rep'),true);
for(const [suffix,name] of [['CONFLICT','John Smith'],['EMPTY',''],['OFFICE','مبيعات مكتب']]){
 body=input([row({reference:'AUTO-ID-'+suffix+'1',employeeId:'auto-mixed-'+suffix,employeeName:'إسلام مصطفى حسين شلبي'}),row({reference:'AUTO-ID-'+suffix+'2',employeeId:'auto-mixed-'+suffix,employeeName:name})]);preview=await post(body);
 check(preview.summary.autoMatchedCount,0);check(preview.documents.find(d=>d.reference.endsWith('1')).repId,'');check(preview.documents.find(d=>d.reference.endsWith('1')).status,'unmapped');
}
body=autoBody('AUTO-OFFICE','مبيعات المكتب');preview=await post(body);check(preview.employees,[]);check(preview.summary.autoMatchedCount,0);check(preview.summary.officeExcludedCount,1);
// Team/region boundaries and inactive accounts still apply to name matches.
rename('rep2','Outside Team Person');rename('west','Western Region Person');member('auto-inactive','rep');rename('auto-inactive','Inactive Rep Person');sql.prepare("UPDATE crm_members SET active=0 WHERE id='auto-inactive'").run();
for(const [suffix,name] of [['TEAM','Outside Team Person'],['REGION','Western Region Person'],['INACTIVE','Inactive Rep Person']]){
 preview=await post(autoBody('AUTO-'+suffix,name));check(preview.documents[0].status,'unmapped');check(preview.documents[0].repId,'');check(preview.employees[0].repId,'');check(preview.summary.autoMatchedCount,0);
}
// Namesakes block inference even if only one account is currently eligible.
member('auto-namesake','rep','western','other-sup');rename('auto-namesake','  إسلام مصطفى حسين شلبي ');
preview=await post(autoBody('AUTO-DUPLICATE-SCOPE'));check(preview.documents[0].status,'unmapped');check(preview.summary.autoMatchedCount,0);
sql.prepare("UPDATE crm_members SET active=0 WHERE id='auto-namesake'").run();preview=await post(autoBody('AUTO-DUPLICATE-INACTIVE'));check(preview.documents[0].status,'unmapped');
rename('auto-namesake','Namesake Different');sql.prepare("UPDATE crm_members SET active=1,region_scope='eastern',supervisor_id='sup' WHERE id='auto-namesake'").run();rename('auto-namesake','JOHN smith');
preview=await post(autoBody('AUTO-DUPLICATE-CASE','John Smith'));check(preview.documents[0].status,'unmapped');check(preview.summary.autoMatchedCount,0);rename('auto-namesake','Namesake Different');
// Name/roster changes after preview reject the old signed preview.
const beforeAutoRaces=count('crm_erp_sales'),importsBeforeAutoRaces=count('crm_erp_imports');
body=autoBody('AUTO-RENAME-PREVIEW');preview=await post(body);rename('auto-rep','إسلام مصطفى حسين شلبي جديد');await commit(body,preview,{},409);rename('auto-rep','إسلام مصطفى حسين شلبي');
body=autoBody('AUTO-DUP-PREVIEW');preview=await post(body);rename('auto-namesake','إسلام مصطفى حسين شلبي');await commit(body,preview,{},409);rename('auto-namesake','Namesake Different');
// Races after commit preparation must fail at the same atomic write gate.
body=autoBody('AUTO-RENAME-RACE');preview=await post(body);race=()=>rename('auto-rep','إسلام مصطفى حسين شلبي جديد');await commit(body,preview,{},409);rename('auto-rep','إسلام مصطفى حسين شلبي');
body=autoBody('AUTO-DUP-RENAME-RACE');preview=await post(body);race=()=>rename('auto-namesake','إسلام مصطفى حسين شلبي');await commit(body,preview,{},409);rename('auto-namesake','Namesake Different');
body=autoBody('AUTO-DUP-INSERT-RACE');preview=await post(body);race=()=>{member('auto-insert-race','rep','western','other-sup');rename('auto-insert-race','إسلام مصطفى حسين شلبي');};await commit(body,preview,{},409);sql.prepare("DELETE FROM crm_members WHERE id='auto-insert-race'").run();
member('auto-promoted-race','customer_service','western','other-sup');rename('auto-promoted-race','إسلام مصطفى حسين شلبي');
body=autoBody('AUTO-DUP-PROMOTION-RACE');preview=await post(body);race=()=>sql.prepare("UPDATE crm_members SET role='rep' WHERE id='auto-promoted-race'").run();await commit(body,preview,{},409);sql.prepare("DELETE FROM crm_members WHERE id='auto-promoted-race'").run();
body=autoBody('AUTO-TRANSFER-RACE');preview=await post(body);race=()=>sql.prepare("UPDATE crm_members SET supervisor_id='other-sup' WHERE id='auto-rep'").run();await commit(body,preview,{},409);sql.prepare("UPDATE crm_members SET supervisor_id='sup' WHERE id='auto-rep'").run();
check(count('crm_erp_sales'),beforeAutoRaces);check(count('crm_erp_imports'),importsBeforeAutoRaces);
check(sql.prepare("SELECT COUNT(*) AS n FROM crm_erp_employee_mappings WHERE employee_id LIKE 'employee-AUTO-%-RACE'").get().n,0);
// A fresh preview after the roster settles can still be committed normally.
body=autoBody('AUTO-AFTER-RACES');preview=await post(body);check(preview.summary.autoMatchedCount,1);check((await commit(body,preview)).importedCount,1);
check(sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');check(sql.prepare('PRAGMA foreign_key_check').all(),[]);
// Missing employee ID/name is normal ERP output: show signed raw totals, skip it
// without authorization to discard ordinary unmatched employees, and never save
// its exclusive employee/category mappings or assign it through an old ID link.
user('sup');
body=input([
 row({reference:'UNASSIGNED-NAME',employeeId:'1001',employeeName:'',category:'Unassigned category only',totalCents:45700}),
 row({reference:'UNASSIGNED-ID',employeeId:'',employeeName:'إسلام مصطفى حسين شلبي',category:'Unassigned category only',totalCents:11200}),
 row({reference:'UNASSIGNED-RETURN',employeeId:'orphan-id',employeeName:'',documentType:'return',category:'Unassigned return only',totalCents:-5300,quantity:-1}),
 row({reference:'UNASSIGNED-GOOD',employeeId:'1001'})
],{employeeMappings:[{employeeId:'orphan-id',repId:'rep'}],categoryMappings:[{category:'Unassigned category only',product:'exclude'},{category:'Unassigned return only',product:'خدمات صيانة'}]});
preview=await post(body);check(preview.summary.unassignedCount,3);check(preview.summary.unassignedTotalCents,51600);check(preview.summary.skippedCount,0);check(preview.summary.unmappedCount,0);check(preview.summary.newCount,1);check(preview.summary.totalCents,30000);
check(preview.categories,['قوالب البلوك المتحركة']);check(preview.employees.map(e=>e.employeeId),['1001']);
for(const doc of preview.documents.filter(d=>d.status==='unassigned')){check(doc.repId,'');check(doc.repName,'');}
check(preview.documents.find(d=>d.reference==='UNASSIGNED-RETURN').totalCents,-5300);
const unassignedReceipt=await commit(body,preview);check(unassignedReceipt.importedCount,1);check(unassignedReceipt.unassignedCount,3);check(unassignedReceipt.unassignedTotalCents,51600);check(unassignedReceipt.skippedCount,0);
check(sql.prepare("SELECT COUNT(*) AS n FROM crm_erp_sales WHERE reference IN ('UNASSIGNED-NAME','UNASSIGNED-ID','UNASSIGNED-RETURN')").get().n,0);
check(sql.prepare("SELECT COUNT(*) AS n FROM crm_erp_employee_mappings WHERE employee_id='orphan-id'").get().n,0);
check(sql.prepare("SELECT COUNT(*) AS n FROM crm_erp_category_mappings WHERE category LIKE 'Unassigned %'").get().n,0);
// Fully specified but unmatched employees still require review/allowSkipped.
body=input([row({reference:'UNASSIGNED-UNKNOWN',employeeId:'known-id-no-match',employeeName:'No matching representative'}),row({reference:'UNASSIGNED-BLANK',employeeId:'',employeeName:''})]);preview=await post(body);
check(preview.summary.unmappedCount,1);check(preview.summary.unassignedCount,1);check(preview.summary.skippedCount,1);await commit(body,preview,{},409);
// Missing fields must never downgrade mixed-invoice conflicts to an auto-skip.
body=input([row({reference:'UNASSIGNED-MIXED',employeeId:'',employeeName:'',category:'Mixed review category'}),row({reference:'UNASSIGNED-MIXED',employeeId:'1001',category:'Mixed review category'})]);preview=await post(body);
check(preview.summary.conflictCount,1);check(preview.summary.unassignedCount,0);check(preview.categories,['Mixed review category']);check(preview.employees.some(e=>e.employeeId==='1001'),true);await commit(body,preview,{},409);
// The user's new complete report is exercised unchanged against a fresh isolated
// SQLite database. Target mappings below are EXPLICIT SYNTHETIC TEST FIXTURES;
// they neither infer production classifications nor change the supplied workbook.
const currentFixture=process.env.ERP_CURRENT_TEST_WORKBOOK||path.resolve(root,'../../upload/Reports_Invoices_14480422_171212.xlsx');
if(!fs.existsSync(currentFixture))throw Error('ERP_CURRENT_TEST_WORKBOOK must point to the current uploaded ERP fixture');
const currentBytes=fs.readFileSync(currentFixture),currentWorkbook=parserReal.parseErpWorkbook(currentBytes);
const currentOffice=currentWorkbook.rows.filter(r=>parserReal.isOfficeEmployee(r.employeeName));
const currentUnassigned=currentWorkbook.rows.filter(r=>!parserReal.isOfficeEmployee(r.employeeName)&&(!r.employeeId||!r.employeeName));
const currentEligible=currentWorkbook.rows.filter(r=>!parserReal.isOfficeEmployee(r.employeeName)&&r.employeeId&&r.employeeName);
check(currentWorkbook.rows.length,96);check(currentOffice.length,52);check(currentUnassigned.length,4);check([...new Set(currentUnassigned.map(r=>r.reference))],['INV-270']);check(currentUnassigned.reduce((sum,r)=>sum+r.totalCents,0),35720000);
const currentSql=new DatabaseSync(':memory:');currentSql.exec('PRAGMA foreign_keys=ON');for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())currentSql.exec(fs.readFileSync('drizzle/'+file,'utf8'));
const currentDB={prepare:q=>new Statement(q,[],currentSql),batch:async statements=>{currentSql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());currentSql.exec('COMMIT');return results;}catch(error){currentSql.exec('ROLLBACK');throw error;}}};
const currentMember=(id,name,role)=>currentSql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?, ?,1,0,?)').run(id,'u-'+id,id+'@yourrest.org',name,role,'test','',role==='admin'?'all':'eastern','2025-01-01');
currentMember('current-admin','Current test administrator','admin');currentSql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-current-admin')").run();
const currentEmployeeIds=[...new Set(currentEligible.map(r=>r.employeeId))],currentTestMappings=currentEmployeeIds.map((employeeId,index)=>({employeeId,repId:'current-rep-'+index}));
for(const mapping of currentTestMappings)currentMember(mapping.repId,currentEligible.find(r=>r.employeeId===mapping.employeeId).employeeName,'rep');
globalThis.testEnv.DB=currentDB;user('current-admin');const currentContext=await domain.context();
const currentBody={action:'preview',fileName:path.basename(currentFixture),base64:currentBytes.toString('base64'),employeeMappings:[],categoryMappings:[],allowSkipped:false};
const currentInitial=await serverReal.importErpSales(currentContext,currentBody);
check(currentInitial.summary.unassignedCount,1);check(currentInitial.summary.unassignedTotalCents,35720000);check(currentInitial.summary.autoMatchedCount,currentEmployeeIds.length);
check(currentInitial.documents.find(d=>d.reference==='INV-270').status,'unassigned');check(currentInitial.documents.find(d=>d.reference==='INV-270').repId,'');check(currentInitial.documents.find(d=>d.reference==='INV-270').totalCents,35720000);
check(currentInitial.employees.every(e=>e.employeeId&&e.employeeName),true);check(currentInitial.categories.includes('خدمات تجارة وتوريد الحديد'),false);check(currentInitial.warnings.includes('توجد بنود بدون رقم أو اسم موظف؛ يلزم مراجعة الربط قبل الاعتماد'),false);
currentBody.categoryMappings=[...new Set(currentEligible.map(r=>r.category))].map(category=>({category,product:'قوالب البلوك المتحركة'}));
const currentPreview=await serverReal.importErpSales(currentContext,currentBody);
check(currentPreview.summary.conflictCount,0);check(currentPreview.summary.skippedCount,0);check(currentPreview.summary.unmappedCount,0);check(currentPreview.summary.unassignedCount,1);check(currentPreview.summary.totalCents,currentEligible.reduce((sum,r)=>sum+r.totalCents,0));
const currentCommitBody={...currentBody,action:'commit',requestId:crypto.randomUUID(),previewToken:currentPreview.previewToken};
const currentReceipt=await serverReal.importErpSales(currentContext,currentCommitBody);check(currentReceipt.unassignedCount,1);check(currentReceipt.unassignedTotalCents,35720000);check(currentReceipt.importedCount,currentPreview.summary.newCount);check(currentReceipt.skippedCount,0);
check((await serverReal.importErpSales(currentContext,currentCommitBody)).alreadySaved,true);
check(currentSql.prepare("SELECT COUNT(*) AS n FROM crm_erp_sales WHERE reference='INV-270'").get().n,0);
check(currentSql.prepare('SELECT COUNT(*) AS n FROM crm_erp_employee_mappings').get().n,currentEmployeeIds.length);
check(currentSql.prepare("SELECT COUNT(*) AS n FROM crm_erp_category_mappings WHERE category='خدمات تجارة وتوريد الحديد'").get().n,0);
check(currentSql.prepare('SELECT SUM(total_cents) AS n FROM crm_erp_sales').get().n,currentEligible.reduce((sum,r)=>sum+r.totalCents,0));
for(const month of currentReceipt.months){const actualSales=await serverReal.readErpSales(currentContext,month);check(actualSales.some(s=>s.reference==='INV-270'),false);check(actualSales.reduce((sum,s)=>sum+s.totalCents,0),currentEligible.filter(r=>r.date.startsWith(month)).reduce((sum,r)=>sum+r.totalCents,0));}
for(const mapping of currentTestMappings){user(mapping.repId);const ownContext=await domain.context();for(const month of currentReceipt.months){const own=await serverReal.readOwnErpSales(ownContext,month);check(own.flatMap(s=>s.items).reduce((sum,item)=>sum+item.quantity,0),currentEligible.filter(r=>r.employeeId===mapping.employeeId&&r.date.startsWith(month)).reduce((sum,r)=>sum+r.quantity,0));}}
user('current-admin');const currentRepeat=await serverReal.importErpSales(await domain.context(),{...currentBody,employeeMappings:[],categoryMappings:[]});check(currentRepeat.summary.newCount,0);check(currentRepeat.summary.duplicateCount,currentReceipt.importedCount);check(currentRepeat.summary.unassignedCount,1);check(currentRepeat.summary.unassignedTotalCents,35720000);
check(currentSql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');check(currentSql.prepare('PRAGMA foreign_key_check').all(),[]);globalThis.testEnv.DB=DB;currentSql.close();
console.log(JSON.stringify({ok:true,checks,scope:'ERP import real SQLite backend + actual uploaded XLSX; no production writes',actualWorkbook:{rows:workbook.rows.length,importedDocuments:realCommit.importedCount,officeExcludedDocuments:realCommit.officeExcludedCount,unassignedDocuments:realCommit.unassignedCount,skippedDocuments:realCommit.skippedCount,months:realCommit.months,usesTestMappings:true},currentWorkbook:{rows:currentWorkbook.rows.length,importedDocuments:currentReceipt.importedCount,officeExcludedDocuments:currentReceipt.officeExcludedCount,unassignedDocuments:currentReceipt.unassignedCount,unassignedNetCents:currentReceipt.unassignedTotalCents,importedNetCents:currentReceipt.totalCents,months:currentReceipt.months,usesSyntheticTestCategoryMappings:true}}));
