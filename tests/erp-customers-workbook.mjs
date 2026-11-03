// The owner's real ERP customer export (gate erp-customers-workbook: `ERP_CUSTOMERS_WORKBOOK=/path/Customer.xlsx npm run check --
// --gate erp-customers-workbook`), read by the same code as the server: the generic sheet reader of
// lib/erp-sales.ts and the header and row reading of lib/erp-customers.ts. The file is given by ERP_CUSTOMERS_WORKBOOK and is never
// copied into the repository. This prints counts and header names only: never a name, phone, email or ID number from the file. Since
// 2026-11-03 it also matches the file against an empty CRM (every named row new), against itself (nothing new) and against its own names
// with words added (the similar-name rule): one word of its own per customer (found, unless the row's words are carried by too many
// customers together), two words each or the same three words for all (never found), in memory only.
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
// Against an empty CRM every valid row with a name is new (added) and the rest invalid; no code changes: the matcher runs over the whole file.
const me={id:'owner',role:'admin',regionScope:'all',name:'',email:'',branch:'',active:1,target:0};
const empty=E.matchErpCustomers(parsed.rows,[],{me});
eq(empty.summary.new+empty.summary.invalid,181,'with no CRM customers every row is new or invalid');
eq(empty.plan.length,0,'and no code would change');
eq(empty.summary.adds,empty.summary.new,'every new row is added by default');
eq(empty.summary.adds<=E.ERP_CUSTOMERS_MAX_ADDS,true,'within the limit of one apply');
eq(empty.adds.every(add=>add.name&&add.name.length<=250&&add.code&&add.phone.length<=250&&add.phone2.length<=250&&add.address.length<=250),true,'every row to add has a name and a code, and its cells fit the customer form');
// Against a CRM made of the file itself (in memory only): every row finds its own customer, nothing is new, nothing changes.
let serial=0;
const own=parsed.rows.filter(row=>!row.issue).map(row=>({id:'c'+(++serial),kind:'customer',parentId:null,assignedTo:'owner',branch:'b',version:1,createdAt:'',updatedAt:'',data:{name:row.name||row.nameEn,phone:row.contact.mobile,phone2:row.contact.phone,code:row.code,region:'',internalCode:'YR-C-'+String(serial).padStart(6,'0')}}));
const itself=E.matchErpCustomers(parsed.rows,own,{me});
eq(itself.summary.new+itself.summary.similar+itself.summary.adds+itself.plan.length,0,'against itself: nothing new, nothing similar, nothing added or changed');
// The similar-name rule on the real names: every customer renamed with words added and given another code, no phones (counted, not shown).
// Each added word is the customer's own (built from its index), so no added word is common and the one-word rule itself is what is tested.
const ownOf=new Map(parsed.rows.filter(row=>!row.issue).map((row,index)=>[row.row,own[index].id]));
const extra=(index,letter)=>'zq'+letter+index;
const renamedWith=words=>own.map((customer,index)=>({...customer,data:{...customer.data,name:customer.data.name+' '+words(index).join(' '),code:'X-'+customer.data.code,phone:'',phone2:''}}));
const findsOwn=customers=>E.matchErpCustomers(parsed.rows.map(row=>({...row,phones:[]})),customers,{me});
const foundOwn=result=>result.rows.filter(row=>row.status==='similar'&&row.candidates.some(candidate=>candidate.id===ownOf.get(row.row))).length;
const renamed=renamedWith(index=>[extra(index,'a')]),similar=findsOwn(renamed);
// Expected: a row whose name has a distinctive word finds its own customer, unless more than ERP_SIMILAR_COMMON renamed customers carry all
// of its words (then those words say nothing about which customer it is, by the rule).
const tokensOf=renamed.map(customer=>new Set(E.similarNameTokens(customer.data.name)));
const rowsWithWords=parsed.rows.filter(row=>!row.issue&&E.similarNameTokens(row.name||row.nameEn).length);
const distinctive=rowsWithWords.length,crowded=rowsWithWords.filter(row=>{const words=E.similarNameTokens(row.name||row.nameEn);return tokensOf.filter(tokens=>words.every(word=>tokens.has(word))).length>E.ERP_SIMILAR_COMMON;}).length;
const foundSelf=foundOwn(similar);
eq(similar.plan.length,0,'renamed: nothing changes without a choice');
eq(foundSelf,distinctive-crowded,'renamed with one word of its own added: every row with a distinctive word finds its own customer among the similar names, except rows whose words more than 20 customers carry together');
eq(similar.rows.every(row=>row.candidates.length<=E.ERP_SIMILAR_MAX),true,'renamed: at most 5 suggestions per row');
const twoWords=foundOwn(findsOwn(renamedWith(index=>[extra(index,'a'),extra(index,'b')])));
eq(twoWords,0,'renamed with two words of its own added: no row finds its own customer (two words more is not similar)');
const sameThree=foundOwn(findsOwn(renamedWith(()=>['الحديثه','الجديده','المتطوره'])));
eq(sameThree,0,'renamed with the same three words added to every name: no row finds its own customer (common words never make names look closer)');
counts.matching={emptyCrm:{new:empty.summary.new,invalid:empty.summary.invalid,adds:empty.summary.adds},againstItself:{auto:itself.summary.auto,same:itself.summary.same,choose:itself.summary.choose,invalid:itself.summary.invalid},renamedOneWord:{rowsWithDistinctiveWord:distinctive,wordsCarriedByMoreThan20:crowded,foundOwnCustomer:foundSelf,similar:similar.summary.similar,new:similar.summary.new,withOtherSuggestions:similar.rows.filter(row=>row.status==='similar'&&row.candidates.length>1).length},renamedTwoWords:{foundOwnCustomer:twoWords},renamedSameThreeWords:{foundOwnCustomer:sameThree}};
console.log(JSON.stringify({ok:true,checks,headers,counts,source:'ERP customer export (counts and header names only)'}));
