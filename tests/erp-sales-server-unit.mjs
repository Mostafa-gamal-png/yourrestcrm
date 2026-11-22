// «استيراد مبيعات ERP» on the server, the doors and the readers, unit by unit (the owner's unit-test plan, 2026-11-22): lib/erp-sales-server.ts
// called directly on an in-memory SQLite with every migration and the real context (lib/crm-server.ts), compiled into .sites-runtime as
// tests/erp-sales-replace.mjs and tests/erp-office-employees.mjs compile it (the workbook reader replaced by rows given as JSON; the real
// reader is tried over HTTP), the clock fixed. Who may import and read (a representative refused; a supervisor's configuration without
// the category and office controls), the configuration (the saved mappings and the office marks), the request (base64, one byte over
// 5 MB, the schema, a mapping twice), the service's secret, the signed preview token (missing, malformed, tampered, other choices,
// expired), the skipped and conflicting documents, «الملف يشمل كل مبيعات المناديب للفترة التي يغطيها» (its period checked, saved with
// the import, read back by readSalesCoverage; a malformed entry left out), the replay, the invoice key (one invoice whatever the spelling
// of its number), the month's ERP sales as the achievement reads them (the reader's team and regions) and a representative's own
// quantities (no amount, no customer). Synthetic rows; made-up names and amounts.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';

const NativeDate=Date;let clock=NativeDate.parse('2026-11-16T09:00:00.000Z');
globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'erp-sales-server-unit-')),seen=new Set();process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=new Proxy({},{get:(_,key)=>globalThis.testEnv?.[key]});');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const id=globalThis.testIdentity;if(!id)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version,email FROM crm_members WHERE id=?').bind(id).first();return {memberId:m?.id,memberVersion:m?.auth_version,email:m?.email};}`);
// The rows as JSON (as tests/erp-sales-replace.mjs gives them); «throw» in the file makes the reader refuse it with its words.
fs.writeFileSync(path.join(out,'parser.mjs'),`export class ErpWorkbookError extends Error{};export function parseErpWorkbook(bytes){const text=new TextDecoder().decode(bytes);if(text==='"throw"')throw new ErpWorkbookError('ملف غير مقروء');const rows=JSON.parse(text);return {rows:rows.map(r=>({description:'',...r})),categories:[...new Set(rows.map(r=>r.category))],employees:[...new Map(rows.map(r=>[r.employeeId,{employeeId:r.employeeId,employeeName:r.employeeName}])).values()],warnings:[],hasDescription:rows.some(r=>typeof r.description==='string')};}`);
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
compile('lib/erp-sales-server.ts');compile('lib/erp-office-employees.ts');
const S=await import(path.join(out,'lib/erp-sales-server.mjs')),O=await import(path.join(out,'lib/erp-office-employees.mjs')),server=await import(path.join(out,'lib/crm-server.mjs'));
let checks=0;
const plain=v=>v===undefined?v:JSON.parse(JSON.stringify(v));
const eq=(a,b,m)=>{assert.deepEqual(plain(a),plain(b),m);checks++;},ok=(v,m)=>{assert.ok(v,m);checks++;};
const refusal=async(promise,status,pattern,message)=>{let error;try{await promise;}catch(e){error=e;}ok(error instanceof server.CRMError&&error.status===status&&pattern.test(error.message),message+' ('+(error?.status??'none')+': '+(error?.message||'no error')+')');};

const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+f,'utf8'));
class Statement{constructor(q,a=[]){this.q=q;this.a=a;}bind(...a){return new Statement(this.q,a);}async run(){const result=sql.prepare(this.q).run(...this.a);return {meta:{changes:Number(result.changes)}};}async all(){return {results:sql.prepare(this.q).all(...this.a)};}async first(){return sql.prepare(this.q).get(...this.a)||null;}}
const DB={prepare:q=>new Statement(q),batch:async statements=>{sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
const SECRET='cd'.repeat(32);// a made-up secret of this test only
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid',YR_AUTH_SECRET:SECRET};
const member=(id,role,{supervisor='',region='all',name=id,active=1}={})=>sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,?,0,?)').run(id,'u-'+id,id+'@example.invalid',name,role,'الفرع',supervisor,region,active,'2025-01-01');
member('admin','admin');member('sm','manager');member('sup','supervisor',{supervisor:'sm'});member('sup2','supervisor',{supervisor:'sm'});
member('rep1','rep',{supervisor:'sup',name:'مندوب ألف'});member('rep2','rep',{supervisor:'sup',name:'مندوب باء'});member('rep3','rep',{supervisor:'sup2',name:'مندوب جيم',region:'western'});
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-admin')").run();
const as=async id=>{globalThis.testIdentity=id;return server.context();};
const A='قوالب البلوك المتحركة';
const line=({ref,date='2026-11-10',emp='E1',name='مندوب ألف',total=1000,qty=1,type='sale',category=A,customer='C1'})=>({rowNumber:1,reference:ref,date,documentType:type,itemCode:'M1',itemName:'قالب',category,quantity:type==='return'?-Math.abs(qty):qty,unit:'حبة',unitPrice:total/100/Math.abs(qty),discountCents:0,totalCents:type==='return'?-Math.abs(total):total,vatCents:0,customerCode:customer,customerName:'مصنع '+customer,employeeId:emp,employeeName:name});
const mappings=[{employeeId:'E1',repId:'rep1'},{employeeId:'E2',repId:'rep2'}];
const body=(rows,extra={})=>({action:'preview',fileName:'sales.xlsx',base64:Buffer.from(JSON.stringify(rows)).toString('base64'),employeeMappings:mappings,categoryMappings:[],...extra});
const count=(table,where='1=1')=>sql.prepare('SELECT count(*) AS n FROM '+table+' WHERE '+where).get().n;

// Who
await refusal(as('rep1').then(c=>S.importErpSales(c,body([line({ref:'A1'})]))),403,/متاحة للمشرف ومدير المبيعات فقط/,'a representative: refused');
await refusal(as('rep1').then(c=>S.erpSalesConfiguration(c)),403,/./,'and the configuration');
await refusal(as('rep1').then(c=>S.readErpSales(c,'2026-11')),403,/./,'and the month\'s ERP sales');
await refusal(as('sm').then(c=>S.readOwnErpSales(c,'2026-11')),403,/هذا العرض خاص بالمندوب/,'a representative\'s own view is a representative\'s');
// The configuration
sql.prepare("INSERT INTO crm_erp_employee_mappings(employee_id,rep_id,updated_by,updated_at) VALUES('E1','rep1','sm','2026-01-01'),('E7','rep2','sm','2026-01-01'),('E9','rep3','sm','2026-01-01')").run();
sql.prepare('INSERT INTO crm_settings(id,owner_id) VALUES(?,?)').run(O.ERP_OFFICE_SETTING,O.serializeOfficeList({employees:[{employeeId:'E7',employeeName:'موظف مكتب',by:'sm',at:'2026-01-01'}]}));
const smConfig=await S.erpSalesConfiguration(await as('sm'));
eq([smConfig.members.map(m=>m.id).sort(),smConfig.employeeMappings.sort((a,b)=>a.employeeId.localeCompare(b.employeeId)),smConfig.canEditCategoryMappings,smConfig.canChangeOffice],[['rep1','rep2','rep3'],[{employeeId:'E1',repId:'rep1'},{employeeId:'E7',repId:O.ERP_OFFICE_CHOICE},{employeeId:'E9',repId:'rep3'}],true,true],'the sales manager: the representatives, the saved mappings, an office mark instead of the mapping it replaced');
const supConfig=await S.erpSalesConfiguration(await as('sup'));
eq([supConfig.members.map(m=>m.id).sort(),supConfig.employeeMappings.map(m=>m.employeeId).sort(),supConfig.canEditCategoryMappings,supConfig.canChangeOffice],[['rep1','rep2'],['E1','E7'],false,false],'a supervisor: their team only, the mark shown, the category and office controls closed');
ok(supConfig.products.includes(A),'the products a category may be mapped to');
sql.prepare('DELETE FROM crm_settings WHERE id=?').run(O.ERP_OFFICE_SETTING);
sql.prepare("DELETE FROM crm_erp_employee_mappings WHERE employee_id IN ('E7','E9')").run();

// The request
let sm=await as('sm');
await refusal(S.importErpSales(sm,{...body([line({ref:'A1'})]),base64:'*'.repeat(8)}),400,/ترميز ملف المبيعات غير صحيح/,'base64 with another character');
await refusal(S.importErpSales(sm,{...body([line({ref:'A1'})]),base64:'QQ='}),400,/ترميز ملف المبيعات غير صحيح/,'base64 of a wrong length');
await refusal(S.importErpSales(sm,{...body([]),base64:'A'.repeat(Math.ceil(5*1024*1024/3)*4)}),413,/5 ميجابايت/,'one byte over 5 MB: 413');
await refusal(S.importErpSales(sm,{...body([]),base64:Buffer.from('"throw"').toString('base64')}),400,/ملف غير مقروء/,'the reader\'s refusal, with its words');
await refusal(S.importErpSales(sm,body([])),400,/./,'a file without rows');
for(const extra of [{categoryMappings:[{category:'x',product:'ليس صنفًا'}]},{requestId:'x'},{action:'apply'}]){let error;try{await S.importErpSales(sm,body([line({ref:'A1'})],extra));}catch(e){error=e;}ok(error?.name==='ZodError','refused by the schema: '+JSON.stringify(extra));}
await refusal(S.importErpSales(sm,body([line({ref:'A1'})],{employeeMappings:[{employeeId:'E1',repId:'rep1'},{employeeId:' E1 ',repId:'rep2'}]})),400,/تكرار في اختيارات الربط/,'the same employee mapped twice');
await refusal(S.importErpSales(sm,body([line({ref:'A1'})],{categoryMappings:[{category:'فئة',product:A},{category:'فئة ',product:'exclude'}]})),400,/تكرار في اختيارات الربط/,'the same category mapped twice');
globalThis.testEnv={...globalThis.testEnv,YR_AUTH_SECRET:''};
await refusal(S.importErpSales(sm,body([line({ref:'A1'})])),503,/غير مهيأة/,'no secret: the preview cannot be signed');
globalThis.testEnv={...globalThis.testEnv,YR_AUTH_SECRET:SECRET};

// The token
const rows=[line({ref:'INV-100',date:'2026-11-03'}),line({ref:'INV-101',date:'2026-11-12',emp:'E2',name:'مندوب باء',total:2500}),line({ref:'INV-102',date:'2026-11-12',type:'return',total:300})];
const file=body(rows);
const preview=await S.importErpSales(sm,file);
eq(preview.documents.map(d=>[d.reference,d.status,d.repId,d.totalCents]),[['INV-100','new','rep1',1000],['INV-101','new','rep2',2500],['INV-102','new','rep1',-300]],'the preview: each document new, mapped, its total (a return negative)');
const pieces=preview.previewToken.split('.');
eq([pieces.length,pieces[0],Number(pieces[1])-clock],[5,'1',15*60_000],'a token signed for fifteen minutes');
const commit=(extra={})=>S.importErpSales(sm,{...file,action:'commit',requestId:crypto.randomUUID(),previewToken:preview.previewToken,...extra});
await refusal(commit({previewToken:undefined}),400,/اعرض الملف أولًا/,'no token');
await refusal(commit({requestId:undefined}),400,/اعرض الملف أولًا/,'no request id');
for(const bad of ['1.2',preview.previewToken.replace(/^1/,'0'),preview.previewToken.replace(/\.\d{13}\./,'.99.'),preview.previewToken+'.x'])await refusal(commit({previewToken:bad}),409,/معاينة الملف غير صحيحة/,'a malformed token');
await refusal(commit({previewToken:[...pieces.slice(0,4),pieces[4].split('').reverse().join('')].join('.')}),409,/تغير الملف أو اختيارات الربط/,'a tampered signature');
await refusal(commit({allowSkipped:true}),409,/تغير الملف أو اختيارات الربط/,'another choice than the preview\'s');
clock+=16*60_000;await refusal(commit(),409,/انتهت المعاينة/,'sixteen minutes later: expired');clock-=16*60_000;
// «الملف يشمل كل المبيعات»: its period checked at the commit
await refusal(commit({completeSnapshot:true,coverageFrom:'2026-11-05',coverageTo:'2026-11-01'}),400,/./,'a period that ends before it starts');
await refusal(commit({completeSnapshot:true,coverageFrom:'2026-11-04',coverageTo:'2026-11-12'}),400,/./,'a period that leaves out an invoice of the file');
const requestId=crypto.randomUUID();
const saved=await commit({requestId,completeSnapshot:true});
eq([saved.importedCount,count('crm_erp_sales')],[3,3],'imported, the period ticked complete (by default the file\'s first and last invoice day)');
const coverage=await S.readSalesCoverage(sm);
eq(coverage.map(c=>[c.complete,c.from,c.to,c.importerId,c.importId]),[[true,'2026-11-03','2026-11-12','sm','erp-import-'+requestId]],'read back: the period, who and the import');
eq(await S.importErpSales(sm,{...file,action:'commit',requestId,previewToken:preview.previewToken,completeSnapshot:true}),{...saved,alreadySaved:true},'the same request again: its first answer');
eq(count('crm_erp_sales'),3,'nothing written twice');
await refusal(S.importErpSales(sm,{...file,action:'commit',requestId,previewToken:preview.previewToken}),409,/./,'the same request id without the tick: another request');
await refusal(S.importErpSales(await as('admin'),{...file,action:'commit',requestId,previewToken:preview.previewToken,completeSnapshot:true}),404,/./,'another person\'s request id');
sql.prepare("INSERT INTO crm_erp_imports(id,actor_id,fingerprint,file_name,result,created_at) VALUES('erp-import-bad','sm','f','x.xlsx',?,'2026-11-16T10:00:00.000Z')").run(JSON.stringify({coverage:{complete:true,from:'not a day'}}));
sm=await as('sm');
eq((await S.readSalesCoverage(sm)).length,1,'a malformed coverage entry is left out');
// Skipped and conflicting documents
const skipped=body([...rows,line({ref:'INV-200',emp:'E5',name:'موظف غير مربوط'})]);
const skippedPreview=await S.importErpSales(sm,skipped);
eq(skippedPreview.documents.find(d=>d.reference==='INV-200').status,'unmapped','an employee nobody mapped: unmapped');
await refusal(S.importErpSales(sm,{...skipped,action:'commit',requestId:crypto.randomUUID(),previewToken:skippedPreview.previewToken}),409,/وافق صراحة على تخطيها/,'skipped documents need the explicit agreement');
const mixed=body([line({ref:'INV-300'}),{...line({ref:'INV-300',emp:'E2',name:'مندوب باء'}),itemCode:'M2'}]);
const mixedPreview=await S.importErpSales(sm,mixed);
eq(mixedPreview.documents.find(d=>d.reference==='INV-300').status,'conflict','a document whose lines name two employees: a conflict');
await refusal(S.importErpSales(sm,{...mixed,action:'commit',requestId:crypto.randomUUID(),previewToken:mixedPreview.previewToken}),409,/يوجد تعارض/,'a conflict blocks the import');

// The invoice key: one invoice whatever the spelling of its number, a year apart another
const key=S.erpInvoiceKey;
ok(/^[a-f0-9]{64}$/.test(await key('INV-100','2026-11-03')),'a SHA-256 key');
eq(await key('INV-100','2026-11-03'),await key('INV-100','2026-01-20'),'the same number in the same year: the same invoice');
ok(await key('INV-100','2026-11-03')!==await key('INV-100','2025-11-03'),'another year: another invoice');
ok(await key('INV-100','2026-11-03')!==await key('INV-101','2026-11-03'),'another number: another invoice');

// The month's ERP sales as the achievement reads them, and a representative's own quantities
const month=await S.readErpSales(sm,'2026-11');
eq(month.map(s=>[s.reference,s.repId,s.totalCents,s.source,s.documentType,s.status,s.customerId]).sort(),[['INV-100','rep1',1000,'erp','sale','confirmed','erp-customer:C1'],['INV-101','rep2',2500,'erp','sale','confirmed','erp-customer:C1'],['INV-102','rep1',-300,'erp','return','confirmed','erp-customer:C1']],'the month\'s ERP sales, confirmed, with their customer\'s code');
eq((await S.readErpSales(sm,'2026-10')).length,0,'another month: none');
eq((await S.readErpSales(sm,'2026-11',{serviceFull:'include'})).length,3,'with the full customer-service sales: the same (none kept)');
sql.prepare("UPDATE crm_erp_sales SET rep_id='rep3',region_scope='western' WHERE reference='INV-101'").run();
eq((await S.readErpSales(await as('sup'),'2026-11')).map(s=>s.reference).sort(),['INV-100','INV-102'],'a supervisor reads their team\'s only');
member('mgw','manager',{region:'central'});
eq((await S.readErpSales(await as('mgw'),'2026-11')).length,0,'a manager limited to the central region: none of these (saved under the regions of their representatives, not central)');
const own=await S.readOwnErpSales(await as('rep1'),'2026-11');
eq(own.sort((a,b)=>a.date.localeCompare(b.date)),[{date:'2026-11-03',items:[{product:A,quantity:1}]},{date:'2026-11-12',items:[{product:A,quantity:-1}]}],'a representative\'s own: the day and the quantities, a return negative; no amount, no customer, nobody else\'s');
eq(await S.readOwnErpSales(await as('rep2'),'2026-11'),[],'another representative: none of them');

console.log(JSON.stringify({ok:true,checks,syntheticFixtures:true,productionDataUsed:false}));
