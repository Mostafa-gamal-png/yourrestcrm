// «استيراد مبيعات ERP» on the server (lib/erp-sales-server.ts), for the cases an independent mutation review (2026-11-22) found no test held,
// called directly on an in-memory SQLite with every migration and the real context (lib/crm-server.ts), on synthetic .xlsx reports of the
// ERP's sixteen columns, the clock fixed: a supervisor's import never replaces what is saved, even when their team is every active
// representative; a saved invoice whose categories are now mapped otherwise is a conflict, not a duplicate; «مبيعات المكتب» and a name
// carrying hidden marks of direction are the office; an employee mapped to a representative out of the importer's reach is not remapped;
// a name two representatives share is never guessed; an item's unit price is its total over its quantity (a discount in the file); one
// invoice of two customer codes is a conflict; a file with documents to map cannot be confirmed complete; a file with a document outside
// the importer's reach does not speak for every representative. Synthetic rows; made-up names and amounts.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';

const NativeDate=Date;let clock=NativeDate.parse('2026-11-16T09:00:00.000Z');
globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'erp-sales-rules-unit-')),seen=new Set();process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=new Proxy({},{get:(_,key)=>globalThis.testEnv?.[key]});');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const id=globalThis.testIdentity;if(!id)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version,email FROM crm_members WHERE id=?').bind(id).first();return {memberId:m?.id,memberVersion:m?.auth_version,email:m?.email,provider:'email-otp'};}`);
function compile(relative){
 if(seen.has(relative))return;seen.add(relative);
 const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});
 let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
  if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));
  if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));
  if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
  let rel=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
  if(!/\.tsx?$/.test(rel))rel+=fs.existsSync(path.join(root,rel+'.ts'))?'.ts':'.tsx';
  compile(rel);return 'from '+JSON.stringify(path.join(out,rel.replace(/\.tsx?$/,'.mjs')));
 });
 fs.writeFileSync(dest,code);
}
compile('lib/erp-sales-server.ts');
const S=await import(path.join(out,'lib/erp-sales-server.mjs')),server=await import(path.join(out,'lib/crm-server.mjs')),sales=await import(path.join(out,'lib/sales.mjs'));
let checks=0;
const plain=v=>v===undefined?v:JSON.parse(JSON.stringify(v));
const eq=(a,b,m)=>{assert.deepEqual(plain(a),plain(b),m);checks++;},ok=(v,m)=>{assert.ok(v,m);checks++;};
const refusal=async(promise,status,pattern,message)=>{let error;try{await promise;}catch(e){error=e;}ok(error instanceof server.CRMError&&error.status===status&&pattern.test(error.message),message+' ('+(error?.status??'none')+': '+(error?.message||'no error')+')');};

const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const f of fs.readdirSync(path.join(root,'drizzle')).filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync(path.join(root,'drizzle',f),'utf8'));
class Statement{constructor(q,a=[]){this.q=q;this.a=a;}bind(...a){return new Statement(this.q,a);}async run(){const result=sql.prepare(this.q).run(...this.a);return {meta:{changes:Number(result.changes)}};}async all(){return {results:sql.prepare(this.q).all(...this.a)};}async first(){return sql.prepare(this.q).get(...this.a)||null;}}
const DB={prepare:q=>new Statement(q),batch:async statements=>{sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid',YR_AUTH_SECRET:'ef'.repeat(32)};// a made-up secret of this test only
const member=(id,role,{supervisor='',region='eastern',name=id,active=1}={})=>sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,?,0,?)').run(id,'u-'+id,id+'@example.invalid',name,role,'الفرع',supervisor,region,active,'2025-01-01');
// Every ACTIVE representative is in «sup»'s team (rep3, of another team and region, is inactive): the supervisor reaches them all.
member('admin','admin',{region:'all'});member('sm','manager');member('sup','supervisor',{supervisor:'sm'});member('sup2','supervisor',{supervisor:'sm',region:'western'});
member('rep1','rep',{supervisor:'sup',name:'مندوب ألف'});member('rep2','rep',{supervisor:'sup',name:'مندوب باء'});
member('twin1','rep',{supervisor:'sup',name:'اسم مكرر'});member('twin2','rep',{supervisor:'sup',name:'اسم مكرر'});
member('rep3','rep',{supervisor:'sup2',name:'مندوب الغرب',region:'western',active:0});
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-admin')").run();
sql.prepare("INSERT INTO crm_erp_employee_mappings(employee_id,rep_id,updated_by,updated_at) VALUES('E9','rep3','admin','2026-01-01')").run();
const as=async id=>{globalThis.testIdentity=id;return server.context();};
const A='قوالب البلوك المتحركة',OTHER=sales.salesProducts.find(product=>product!==A);
ok(sales.salesProducts.includes(A)&&OTHER,'two products to map to');
const line=({ref,date='2026-11-10',emp='E1',name='مندوب ألف',total=1000,qty=1,unit,type='sale',category=A,customer='C1',customerName,item='M1'})=>({reference:ref,date,type,item,category,qty,total,unit:unit??total/qty,customer,customerName:customerName??'مصنع '+customer,emp,name});
const HEADERS=['رقم الفاتورة','التاريخ','النوع','رقم الصنف','اسم الصنف','الفئة','الكمية','الوحدة','سعر الوحدة','الخصم','الإجمالي','القيمة المضافة','رقم العميل','اسم العميل','رقم الموظف','اسم الموظف'];
const riyals=cents=>(cents/100).toFixed(2);
const cells=r=>[r.reference,r.date,r.type==='return'?'مرتجع مبيعات':'فاتورة مبيعات',r.item,'قالب',r.category,String(r.qty),'حبة',riyals(r.unit),'0',riyals(r.total),'0',r.customer,r.customerName,r.emp,r.name];
const xml=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;');
const xlsx=table=>zipSync({'[Content_Types].xml':strToU8('<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'),'xl/workbook.xml':strToU8('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>'),'xl/_rels/workbook.xml.rels':strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),'xl/worksheets/sheet1.xml':strToU8('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+table.map(cellsOf=>'<row>'+cellsOf.map(v=>'<c t="inlineStr"><is><t>'+xml(v)+'</t></is></c>').join('')+'</row>').join('')+'</sheetData></worksheet>')});
const mappings=[{employeeId:'E1',repId:'rep1'},{employeeId:'E2',repId:'rep2'}];
const body=(rows,extra={})=>({action:'preview',fileName:'sales.xlsx',base64:Buffer.from(xlsx([HEADERS,...rows.map(cells)])).toString('base64'),employeeMappings:mappings,categoryMappings:[],...extra});
const importNow=async(who,file)=>{const c=await as(who),preview=await S.importErpSales(c,file);return S.importErpSales(c,{...file,action:'commit',requestId:crypto.randomUUID(),previewToken:preview.previewToken});};
const statusOf=(preview,ref)=>preview.documents.find(d=>d.reference===ref)?.status;

// ---- A saved invoice and a sale with a discount: the unit price is the total over the quantity.
await importNow('sm',body([line({ref:'INV-1'}),line({ref:'INV-2',qty:2,total:100000,unit:60000})]));
const saved=JSON.parse(sql.prepare("SELECT data FROM crm_erp_sales WHERE reference='INV-2'").get().data);
eq([saved.items[0].quantity,saved.items[0].unitPrice],[2,500],'1000 riyals for two: 500 each, not the 600 the file lists before its discount');

// ---- A supervisor whose team is every active representative: the file never replaces what is saved.
const sup=await as('sup');
let preview=await S.importErpSales(sup,body([line({ref:'INV-3'})],{wholeCompany:true}));
eq([preview.replacement,preview.documents.some(d=>d.status==='removed')],[undefined,false],'a supervisor\'s import replaces nothing, removes nothing');
preview=await S.importErpSales(await as('sm'),body([line({ref:'INV-3'})],{wholeCompany:true}));
ok(preview.replacement&&preview.documents.some(d=>d.reference==='INV-1'&&d.status==='removed'),'the sales manager\'s does (the saved INV-1 is not in the file)');

// ---- The same invoice, its category now mapped to another product: a conflict, not a duplicate.
preview=await S.importErpSales(await as('sm'),body([line({ref:'INV-1'})],{categoryMappings:[{category:A,product:OTHER}]}));
eq(statusOf(preview,'INV-1'),'conflict','its content the same, its mapping not: a conflict');
preview=await S.importErpSales(await as('sm'),body([line({ref:'INV-1'})]));
eq(statusOf(preview,'INV-1'),'duplicate','with the same mapping: a duplicate');

// ---- The office: «مبيعات المكتب», and the name with hidden marks of direction.
preview=await S.importErpSales(await as('sm'),body([line({ref:'INV-4',emp:'E3',name:'مبيعات المكتب'}),line({ref:'INV-5',emp:'E4',name:'مبيعات‏ مكتب‎'})]));
eq([statusOf(preview,'INV-4'),statusOf(preview,'INV-5')],['excluded','excluded'],'both spellings, and the marks of direction, are the office');
ok(preview.documents.find(d=>d.reference==='INV-5').reason.startsWith('مبيعات مكتب'),'excluded as the office');

// ---- An employee mapped to a representative out of the importer's reach is not remapped by them.
await refusal(S.importErpSales(sup,body([line({ref:'INV-6',emp:'E9',name:'مندوب الغرب'})],{employeeMappings:[{employeeId:'E9',repId:'rep1'}]})),403,/خارج نطاق فريقك أو منطقتك/,'remapping another team\'s employee: refused');

// ---- A name two representatives share is never guessed.
preview=await S.importErpSales(await as('sm'),body([line({ref:'INV-7',emp:'E7',name:'اسم مكرر'})],{employeeMappings:[]}));
eq([statusOf(preview,'INV-7'),preview.employees.find(e=>e.employeeId==='E7').repId],['unmapped',''],'two of that name: unmapped');

// ---- One invoice of two customer codes (the same customer's name) is a conflict.
preview=await S.importErpSales(await as('sm'),body([line({ref:'INV-8',customer:'C1',customerName:'مصنع واحد'}),line({ref:'INV-8',customer:'C2',customerName:'مصنع واحد',item:'M2'})]));
eq(statusOf(preview,'INV-8'),'conflict','two customer codes in one invoice: a conflict');

// ---- Completeness: documents still to map block it; a document outside the reach means not every representative.
preview=await S.importErpSales(await as('sm'),body([line({ref:'INV-9'}),line({ref:'INV-10',emp:'E8',name:'موظف جديد'})],{employeeMappings:[{employeeId:'E1',repId:'rep1'}]}));
ok(preview.summary.unmappedCount>0&&preview.coverage.blocker!=='','a file with a document to map cannot be confirmed complete');
preview=await S.importErpSales(await as('sm'),body([line({ref:'INV-11'}),line({ref:'INV-12',emp:'E9',name:'مندوب الغرب'})]));
eq([statusOf(preview,'INV-12'),preview.coverage.allReps],['out_of_scope',false],'a document of a representative out of reach: the file does not speak for everyone');

console.log(JSON.stringify({ok:true,checks}));
