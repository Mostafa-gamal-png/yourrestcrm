// The owner's real ERP quotations report (gate erp-quotes-workbook: `ERP_QUOTES_WORKBOOK=/path/Reports_Invoices.xls npm run check --
// --gate erp-quotes-workbook`), read and planned by the same code as the server (lib/erp-quotes.ts): the reader of the ERP's HTML «.xls»,
// the columns, the grouping by quotation number, the figures (Σ lines − document discount = Subtotal, its VAT = VAT_AmountM, with it
// NewSubtotal; the CRM's own sums against them), and the plan against an in-memory CRM made of the file's own customer codes (every
// quotation new), then against the quotes that import would write (every quotation unchanged), then with one of them edited by hand (left
// alone). The file is given by ERP_QUOTES_WORKBOOK and is never copied into the repository. It prints counts and column names only: never
// a customer, a phone, a VAT number, an address, an item or a price.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const fixture=process.env.ERP_QUOTES_WORKBOOK||'';
if(!fixture||!fs.existsSync(fixture))throw new Error('Set ERP_QUOTES_WORKBOOK to the ERP quotations report (the owner\'s Reports_Invoices .xls). No workbook checks have run.');
const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'erp-quotes-workbook-')),seen=new Set();
process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
function compile(relative){
 if(seen.has(relative))return;seen.add(relative);
 const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});
 let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
  if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
  let child=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
  if(!/\.tsx?$/.test(child))child+=fs.existsSync(path.join(root,child+'.ts'))?'.ts':'.tsx';
  compile(child);return 'from '+JSON.stringify(path.join(out,child.replace(/\.tsx?$/,'.mjs')));
 });
 fs.writeFileSync(dest,code);
}
compile('lib/erp-quotes.ts');
const Q=await import(path.join(out,'lib/erp-quotes.mjs')),I=await import(path.join(out,'lib/customer-identity.mjs'));
let checks=0;
// Assertion messages carry counts only; a failing deepEqual would print values, so compare numbers and booleans alone.
const eq=(actual,expected,message)=>{assert.ok(actual===expected,`${message}: expected ${expected}, got ${typeof actual==='number'||typeof actual==='boolean'?actual:'(withheld)'}`);checks++;};

const bytes=new Uint8Array(fs.readFileSync(fixture));
eq(bytes.length<=Q.ERP_QUOTES_MAX_BYTES,true,'the file fits the route\'s 5 MB file limit');
eq(Math.ceil(bytes.length/3)*4<7_500_000,true,'its base64 fits the route\'s 7 500 000-byte request limit');
eq(bytes[0]===0xff&&bytes[1]===0xfe,true,'UTF-16LE with a byte-order mark, as the ERP saves it');
const sheet=Q.readErpQuotesTable(bytes),file=Q.parseErpQuotes(sheet);
for(const column of ['Code','Trans_Type_Code','Date1','Expiration_Date','CustomerCode','Emp_Code','Item_Name','Qty','Price','Discount_Amount','Total','VAT','Subtotal','VAT_AmountM','NewSubtotal','Discount_Amount_M','Payment_Terms_Name','Delivery_Term','Document_Note'])eq(file.columns.includes(column),true,`column ${column} is present`);
const quotations=file.quotations,ok=quotations.filter(q=>!q.problem);
const counts={
 columns:file.columns.length,lineRows:file.rowCount,deletedRows:file.deletedRows,rowsWithoutNumber:file.problems.length,quotations:quotations.length,
 lines:quotations.reduce((s,q)=>s+q.lines.length,0),customers:new Set(quotations.map(q=>q.customerCode)).size,employees:new Set(quotations.map(q=>q.employeeCode)).size,
 refusedInFile:quotations.length-ok.length,linesPerQuotation:Object.fromEntries([...new Set(quotations.map(q=>q.lines.length))].sort((a,b)=>a-b).map(n=>[n,quotations.filter(q=>q.lines.length===n).length])),
 withDocumentDiscount:ok.filter(q=>q.documentDiscountCents>0).length,withLineDiscount:ok.filter(q=>q.lines.some(l=>l.discountCents>0)).length,
 vatRates:new Set(ok.map(q=>q.vatRate)).size,withTerms:ok.filter(q=>Q.erpQuoteTerms(q)).length,validityMissingOrEarlier:ok.filter(q=>!q.validUntil||q.validUntil<q.date).length,
};
eq(counts.columns,197,'197 columns');
eq(counts.lineRows,49,'49 line rows');
eq(counts.quotations,38,'38 quotations');
eq(counts.lines,49,'49 lines');
eq(counts.customers,29,'29 customers');
eq(counts.refusedInFile,0,'every quotation adds up (Σ lines − document discount = Subtotal, VAT_AmountM, NewSubtotal)');
eq(quotations.every(q=>q.date>='2026-11-01'&&q.date<='2026-11-11'),true,'dates 2026-11-01 to 2026-11-11');
let crmAgrees=0,schemaValid=0;
for(const q of ok){const made=Q.erpQuoteFields(q);if(!made.differ)crmAgrees++;const sum=made.fields.items.length;eq(sum,q.lines.length,'one item per line');eq(Math.round(made.fields.total*100),q.totalCents,'the stored total is the ERP\'s NewSubtotal');}
counts.crmTotalsAgreeWithinAHalala=crmAgrees;counts.crmTotalsDiffer=ok.length-crmAgrees;
// Planned against a CRM holding one customer per ERP customer code of the file and one representative for every ERP employee (in memory).
const customers=[...new Set(quotations.map(q=>q.customerCode))].map((code,index)=>({id:'c'+index,kind:'customer',parentId:null,assignedTo:'rep',branch:'الرئيسي',version:1,createdAt:'',updatedAt:'',data:{name:'عميل '+index,code,region:'الوسطى'}}));
const rep={id:'rep',name:'مندوب',role:'rep',branch:'الرئيسي',email:'rep@yourrest.org',active:1,target:0};
const employeeReps=new Map(quotations.map(q=>[Q.employeeKey(q.employeeCode),'rep']));
const plan=async records=>Q.planErpQuotes({file,records,visibleIds:new Set(records.map(r=>r.id)),codes:I.uniqueCustomerCodes(records),employeeReps,eligible:new Map([['rep',rep]]),customerInRegion:()=>true,importer:{id:'owner',name:'مدير'},now:'2026-11-11T10:00:00.000Z',importId:'erp-quotes-import-x',fileName:'q.xls'});
const first=await plan(customers),status=entries=>Object.fromEntries(['new','update','unchanged','edited','refused'].map(s=>[s,entries.filter(e=>e.status===s).length]));
eq(first.filter(e=>e.status==='new').length,38,'against the customers of the file: every quotation is new');
const written=first.filter(e=>e.status==='new').map(e=>({id:e.recordId,kind:'quote',parentId:e.customerId,assignedTo:e.repId,branch:e.branch,version:1,createdAt:'',updatedAt:'',data:e.data}));
schemaValid=written.length;
const again=await plan([...customers,...written]);
eq(again.filter(e=>e.status==='unchanged').length,38,'the same file again: every quotation unchanged');
const edited=written.map((r,i)=>i===0?{...r,version:2,data:{...r.data,status:'accepted'}}:r);
const third=await plan([...customers,...edited]);
eq(third.filter(e=>e.status==='edited').length,1,'one edited by hand: left alone');
eq(third.filter(e=>e.status==='unchanged').length,37,'the rest unchanged');
const none=await plan([]);
eq(none.filter(e=>e.status==='refused').length,38,'against an empty CRM: every quotation refused (customer not in the CRM)');
console.log(JSON.stringify({...counts,planAgainstFileCustomers:status(first),reimport:status(again),oneEditedByHand:status(third),emptyCrm:status(none),written:schemaValid}));
console.log(`erp-quotes-workbook: ${checks} checks passed`);
