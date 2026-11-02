// The owner's real ERP customer export (gate erp-customers-workbook: `ERP_CUSTOMERS_WORKBOOK=/path/Customer.xlsx npm run check --
// --gate erp-customers-workbook`), read by the same code as the server: the generic sheet reader of
// lib/erp-sales.ts and the header and row reading of lib/erp-customers.ts. The file is given by ERP_CUSTOMERS_WORKBOOK and is never
// copied into the repository. This prints counts and header names only: never a name, phone, email or ID number from the file.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const fixture=process.env.ERP_CUSTOMERS_WORKBOOK||'';
if(!fixture||!fs.existsSync(fixture))throw new Error('Set ERP_CUSTOMERS_WORKBOOK to the ERP customer export (the owner\'s Customer xlsx). No workbook checks have run.');
const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'erp-customers-workbook-')),seen=new Set();
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
compile('lib/erp-customers.ts');compile('lib/erp-sales.ts');
const E=await import(path.join(out,'lib/erp-customers.mjs')),S=await import(path.join(out,'lib/erp-sales.mjs'));
let checks=0;
// Assertion messages carry counts only; a failing deepEqual would print values, so compare numbers and booleans alone.
const eq=(actual,expected,message)=>{assert.ok(actual===expected,`${message}: expected ${expected}, got ${typeof actual==='number'||typeof actual==='boolean'?actual:'(withheld)'}`);checks++;};

const bytes=fs.readFileSync(fixture);
eq(bytes.length<=1024*1024,true,'the file fits the route\'s 1 MB file limit');
eq(Math.ceil(bytes.length/3)*4<2_000_000,true,'its base64 fits the route\'s 2 000 000-byte request limit');
const sheets=S.readWorkbookSheets(new Uint8Array(bytes),{maxRows:E.ERP_CUSTOMERS_MAX_ROWS});
const parsed=E.erpCustomerRows(sheets);
const sheet=sheets.find(s=>s.name===parsed.sheet),headerIndex=sheet.rows.findIndex(row=>row.cells.includes(E.erpCustomerColumns.code));
const headers=sheet.rows[headerIndex].cells;
eq(parsed.sheet,'Customer','the customer sheet is found by its header');
eq(headerIndex,1,'the header is the second row, under the title row');
for(const label of Object.values(E.erpCustomerColumns))eq(headers.includes(label),true,`header column «${label}» is present`);
eq(parsed.rows.length,181,'customer rows');
eq(parsed.rows.every(row=>row.code&&row.issue!=='no-code'),true,'every row has a customer number');
eq(parsed.rows.every((row,index)=>row.row===index+3),true,'rows are the sheet rows 3 to 183');
const duplicates=parsed.rows.filter(row=>row.issue==='duplicate-code').length,long=parsed.rows.filter(row=>row.issue==='long-code').length;
eq(long,0,'no over-long number');
eq(parsed.rows.filter(row=>row.issue==='too-many-phones').length,0,'no row lists too many phone numbers or an over-long phone cell');
const counts={
 sheets:sheets.length,rows:parsed.rows.length,duplicateNumberRows:duplicates,
 numbersAllDigits:parsed.rows.filter(row=>/^\d+$/.test(row.code)).length,
 numberLengths:Object.fromEntries([...new Set(parsed.rows.map(row=>row.code.length))].sort((a,b)=>a-b).map(n=>[n,parsed.rows.filter(row=>row.code.length===n).length])),
 withArabicName:parsed.rows.filter(row=>row.name).length,withSecondName:parsed.rows.filter(row=>row.nameEn).length,
 withAnyValidPhone:parsed.rows.filter(row=>row.phones.length).length,withTwoValidPhones:parsed.rows.filter(row=>row.phones.length>1).length,
 withNeitherNameNorPhone:parsed.rows.filter(row=>!row.name&&!row.nameEn&&!row.phones.length).length,
};
// Against an empty CRM every valid row is missing and nothing is planned: the matcher runs over the whole file without error.
const empty=E.matchErpCustomers(parsed.rows,[],{me:{id:'owner',role:'admin',regionScope:'all',name:'',email:'',branch:'',active:1,target:0}});
eq(empty.summary.missing+empty.summary.invalid,181,'with no CRM customers every row is missing or invalid');
eq(empty.plan.length,0,'and nothing would change');
console.log(JSON.stringify({ok:true,checks,headers,counts,source:'ERP customer export (counts and header names only)'}));
