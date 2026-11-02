// The ERP customer import (lib/erp-customers.ts), as pure functions: finding the header of the ERP customer export by its names, the
// phone and name keys, every outcome of matching an ERP row to CRM customers (auto by phone, by name or by both, choose when they point
// to different customers or to several, missing, same, two rows on one customer), the mapping needed when another customer holds the
// number, the manager's regions, the user's choices, and the plan the apply writes. Also the generic sheet reader (lib/erp-sales.ts
// readWorkbookSheets) on synthetic workbooks. Synthetic data only: no database, no network, never the owner's file.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {zipSync,strToU8} from 'fflate';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'erp-customers-')),seen=new Set();
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
const eq=(actual,expected,message)=>{assert.deepEqual(actual===undefined?undefined:JSON.parse(JSON.stringify(actual)),expected,message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};
const throws=(run,pattern,message)=>{assert.throws(run,error=>error instanceof E.ErpCustomersError&&pattern.test(error.message),message);checks++;};

// ---- phone keys
const phone=E.phoneKeys;
eq(phone('+966 55 123 4567'),['551234567'],'+966 and spaces');
eq(phone('00966551234567'),['551234567'],'00966');
eq(phone('966551234567'),['551234567'],'966 without plus');
eq(phone('0551234567'),['551234567'],'a leading 0');
eq(phone('551234567'),['551234567'],'nine digits already');
eq(phone('055-123-4567'),['551234567'],'dashes inside one number');
eq(phone('(055) 123 4567'),['551234567'],'brackets inside one number');
eq(phone('٠٥٥١٢٣٤٥٦٧'),['551234567'],'Arabic-Indic digits');
eq(phone('۰۵۵۱۲۳۴۵۶۷'),['551234567'],'Persian digits');
eq(phone('+٩٦٦٥٥١٢٣٤٥٦٧'),['551234567'],'Arabic digits with +966');
eq(phone('0112345678'),['112345678'],'a Riyadh landline');
eq(phone('+966 11 234 5678'),['112345678'],'a landline with +966');
eq(phone('+966 0551234567'),['551234567'],'+966 then a local 0');
eq(phone('‏0551234567‎'),['551234567'],'direction marks are not digits');
eq(phone('0551234567 / 0501234567'),['551234567','501234567'],'two numbers separated by /');
eq(phone('0551234567، 0112345678'),['551234567','112345678'],'Arabic comma between numbers');
eq(phone('0551234567\n0551234567'),['551234567'],'the same number twice counts once');
eq(phone('0551234567 0501234567'),[],'two numbers run together are no number (nothing guessed)');
eq(phone('0712345678'),[],'a number not starting with 5 or 1 is no Saudi mobile or landline');
eq(phone('12345'),[],'too short');
eq(phone('05512345678'),[],'too long');
eq(phone('+971 50 123 4567'),[],'a foreign number');
eq([phone(''),phone(null),phone(undefined)],[[],[],[]],'nothing is no number');
eq(phone(551234567),['551234567'],'a number cell');

// ---- name keys
const name=E.nameKey;
eq(name('مَصْنَعُ النُّور'),name('مصنع النور'),'harakat dropped');
eq(name('مصـــنع النور'),name('مصنع النور'),'tatweel dropped');
eq([name('أحمد'),name('إحسان'),name('آمال'),name('ٱلنور')],['احمد','احسان','امال','النور'],'alef forms');
eq(name('مصطفى'),'مصطفي','alef maqsura');
eq(name('مؤسسة'),'موسسه','waw hamza and ta marbuta');
eq(name('شاطئ'),'شاطي','ya hamza');
eq(name('  مصنع   النور  '),'مصنع النور','spaces collapse');
eq(name('مصنع النور - فرع (٢)'),'مصنع النور فرع 2','punctuation as spaces, Arabic digits plain');
eq(name('Al-Noor Factory'),'al noor factory','Latin in lower case');
eq(name('مصنع‏النور'),'مصنعالنور','an invisible mark is dropped, not a space');
ok(name('مصنع النور')!==name('مصنع النور للبلاستيك'),'a longer name is another name (no partial matching)');
ok(name('مصنع النور')!==name('النور'),'a word dropped is another name');
eq(name(''),'','an empty name');

// ---- header detection
const header=['رقم العميل','رقم الهوية','الاسم بالعربي','الاسم بالانجليزي','رقم الجوال','رقم الهاتف','البريد الالكتروني','العنوان','التاريخ'];
const sheet=(rows,name='Customer')=>({name,rows:rows.map((cells,index)=>({rowNumber:index+1,cells}))});
const line=(code,arabic,english,mobile,landline)=>[code,'1000000000',arabic,english,mobile,landline,'','A B C D 1 2 3 4','2026/01/02'];
let parsed=E.erpCustomerRows([sheet([['العملاء'],header,line('7','مصنع النور','مصنع النور','+966551234567','0112345678'),['','','','','','','','',''],line('12','مصنع الفجر','','','0501234567')])]);
eq(parsed.sheet,'Customer','the sheet found');
eq(parsed.rows.map(r=>r.row),[3,5],'data starts below the header; blank rows are skipped; sheet row numbers are kept');
eq(parsed.rows[0],{row:3,code:'7',codeKey:'7',name:'مصنع النور',nameEn:'مصنع النور',phones:['551234567','112345678'],issue:''},'one row: number, names, both phone columns');
eq(parsed.rows[1].phones,['501234567'],'a landline column holding a mobile is read as a phone too');
parsed=E.erpCustomerRows([sheet([header,line('1','أ','','','')])]);
eq(parsed.rows.map(r=>r.row),[2],'a header on the first row');
parsed=E.erpCustomerRows([sheet([['التاريخ','رقم الجوال','رقم العميل'],['2026/01/02','0551234567','9']])]);
eq([parsed.rows[0].code,parsed.rows[0].phones],['9',['551234567']],'columns are found by name, in any order, the phone alone is enough');
parsed=E.erpCustomerRows([sheet([[' رقم  العميل‏ ','الإسم بالعربي'],['5','مصنع']])]);
eq(parsed.rows[0].name,'مصنع','header spelling: spaces, marks and hamza on alef do not matter');
parsed=E.erpCustomerRows([sheet([['ملخص'],['لا شيء']],'Summary'),sheet([['العملاء'],header,line('3','مصنع','','','')])]);
eq([parsed.sheet,parsed.rows.length],['Customer',1],'the first sheet with the header is read');
parsed=E.erpCustomerRows([sheet([header,line('1','مصنع','','',''),header,line('2','مصنع آخر','','','')])]);
eq(parsed.rows.map(r=>r.code),['1','2'],'a repeated header row is skipped');
parsed=E.erpCustomerRows([sheet([header,line('','مصنع بلا رقم','','0551234567',''),line('8','أ','','',''),line('٨','ب','','',''),line('9','ج','','',''),line('x'.repeat(101),'د','','','')])]);
eq(parsed.rows.map(r=>r.issue),['no-code','duplicate-code','duplicate-code','','long-code'],'a row without a number, a number twice in the file (Arabic digits are the same number) and an over-long number are marked');
throws(()=>E.erpCustomerRows([sheet([['الاسم بالعربي','رقم الجوال'],['مصنع','0551234567']])]),/رقم العميل/,'no number column: refused, naming the column');
throws(()=>E.erpCustomerRows([sheet([['رقم العميل','البريد الالكتروني'],['1','a@b.c']])]),/الاسم أو الجوال/,'a number without a name or phone column: refused');
throws(()=>E.erpCustomerRows([sheet([['رقم الفاتورة','التاريخ','رقم العميل','اسم العميل'],['INV-1','2026/01/01','7','مصنع']])]),/مش ملف عملاء ERP/,'the ERP sales report is not a customer file');
throws(()=>E.erpCustomerRows([sheet([['رقم العميل','الاسم بالعربي','الاسم بالعربي'],['1','أ','ب']])]),/عمود مكرر/,'a duplicated column is refused');
throws(()=>E.erpCustomerRows([sheet([header])]),/لا يحتوي صفوف/,'a header without rows');
throws(()=>E.erpCustomerRows([sheet([header,...Array.from({length:20001},(_,i)=>line(String(i+1),'م','','',''))])]),/20000/,'more than 20 000 customers');
eq(E.erpCustomerRows([sheet([header,...Array.from({length:20000},(_,i)=>line(String(i+1),'م','','',''))])]).rows.length,20000,'20 000 customers are read');

// ---- matching
const admin={id:'owner',role:'admin',regionScope:'all',name:'Owner',email:'o@x',branch:'b',active:1,target:0};
const manager={id:'m1',role:'manager',regionScope:'central',name:'Manager',email:'m@x',branch:'b',active:1,target:0};
let serial=0;
const customer=(id,data)=>({id,kind:'customer',parentId:null,assignedTo:'rep',branch:'b',version:3,createdAt:'',updatedAt:'',data:{name:id,code:'',phone:'',phone2:'',region:'الوسطى',internalCode:'YR-C-'+String(++serial).padStart(6,'0'),...data}});
const erp=(row,code,arabic,phones=[],english='')=>({row,code,codeKey:String(code).toUpperCase(),name:arabic,nameEn:english,phones,issue:''});
const match=(rows,customers,options={})=>E.matchErpCustomers(rows,customers,{me:admin,...options});
const one=(rows,customers,options)=>match(rows,customers,options).rows[0];
const nour=customer('nour',{name:'مصنع النور',phone:'0551234567',code:'C-1'}),fajr=customer('fajr',{name:'مصنع الفجر',phone2:'+966 50 123 4567'}),badr=customer('badr',{name:'مصنع البدر',phone:'0112345678'});
let r=one([erp(3,'12','مصنع غير موجود',['551234567'])],[nour,fajr,badr]);
eq([r.status,r.matchedBy,r.customerId,r.from,r.to,r.change,r.candidates.map(c=>c.id)],['auto','phone','nour','C-1','12',true,['nour']],'auto by phone: one customer, the old code and the new');
eq(r.candidates[0],{id:'nour',name:'مصنع النور',internalCode:nour.data.internalCode,code:'C-1',region:'الوسطى',phones:['4567'],matchedBy:'phone'},'the candidate as shown: name, Yourrest code, ERP code, region, phone masked to its last 4 digits');
eq(r.phones,['4567'],'the ERP phones are masked to their last 4 digits too');
r=one([erp(3,'12','مصنعُ الفَجْر')],[nour,fajr,badr]);
eq([r.status,r.matchedBy,r.customerId],['auto','name','fajr'],'auto by name, spelled loosely');
r=one([erp(3,'12','—','',)].map(row=>({...row,phones:[],nameEn:'مصنع البدر'})),[nour,fajr,badr]);
eq([r.status,r.matchedBy,r.customerId],['auto','name','badr'],'the second ERP name column matches as well');
r=one([erp(3,'12','مصنع الفجر',['501234567'])],[nour,fajr,badr]);
eq([r.status,r.matchedBy,r.customerId],['auto','both','fajr'],'auto by both phone and name');
r=one([erp(3,'12','مصنع الفجر',['551234567'])],[nour,fajr,badr]);
eq([r.status,r.customerId,r.candidates.map(c=>[c.id,c.matchedBy])],['choose','',[['nour','phone'],['fajr','name']]],'phone and name point to different customers: choose');
const twin=customer('twin',{name:'مصنع النور',code:'C-9'});
r=one([erp(3,'12','مصنع النور')],[nour,twin,fajr]);
eq([r.status,r.candidates.map(c=>c.id)],['choose',['nour','twin']],'a name several customers carry: choose');
const shared=customer('shared',{name:'مصنع آخر',phone:'0551234567'});
r=one([erp(3,'12','',['551234567'])],[nour,shared]);
eq([r.status,r.candidates.map(c=>c.id)],['choose',['nour','shared']],'a phone several customers carry: choose');
r=one([erp(3,'12','مصنع الأمل',['559999999'])],[nour,fajr]);
eq([r.status,r.candidates,r.customerId,r.change],['missing',[],'',false],'no customer: missing, nothing created');
r=one([erp(3,'c-1','مصنع النور')],[nour,fajr]);
eq([r.status,r.customerId,r.from,r.to,r.change,r.mapping],['same','nour','C-1','c-1',false,false],'the customer already has this number: same, no change');
r=one([erp(3,'12','مصنع النور للبلاستيك',['000'])],[nour]);
eq(r.status,'missing','a longer name is not a match and a broken phone matches nothing');

// two rows ending on one customer
let result=match([erp(3,'12','مصنع النور'),erp(4,'13','',['551234567'])],[nour,fajr]);
eq(result.rows.map(o=>[o.status,o.conflict,o.customerId]),[['choose',true,'nour'],['choose',true,'nour']],'two rows on one customer: both choose, in conflict');
eq([result.summary.conflicts,result.plan.length],[2,0],'nothing is planned while they conflict');
result=match([erp(3,'12','مصنع النور'),erp(4,'C-1','',['551234567'])],[nour,fajr]);
eq(result.rows.map(o=>[o.status,o.conflict]),[['choose',true],['choose',true]],'a same row and an auto row on one customer conflict too');
result=match([erp(3,'12','مصنع النور'),erp(4,'13','',['551234567'])],[nour,fajr],{choices:new Map([[4,'']])});
eq(result.rows.map(o=>[o.status,o.conflict,o.customerId,o.chosen]),[['auto',false,'nour',false],['auto',false,'',true]],'leaving one of them resolves the conflict');
eq(result.plan.map(p=>[p.row,p.customerId,p.from,p.to,p.codeChange,p.mapping,p.version]),[[3,'nour','C-1','12',true,false,3]],'and the other is planned');
result=match([erp(3,'12','مصنع النور',['501234567'])],[nour,fajr],{choices:new Map([[3,'fajr']])});
eq([result.rows[0].status,result.rows[0].customerId,result.rows[0].chosen,result.rows[0].matchedBy,result.plan.map(p=>p.customerId)],['choose','fajr',true,'phone',['fajr']],'a choice among the candidates');
result=match([erp(3,'12','مصنع النور',['501234567'])],[nour,fajr]);
eq([result.summary.pending,result.plan.length],[1,0],'an unanswered choice is pending and changes nothing');
result=match([erp(3,'12','مصنع النور',['501234567'])],[nour,fajr],{choices:new Map([[3,'']])});
eq([result.summary.pending,result.rows[0].chosen,result.plan.length],[0,true,0],'a choice left as it is');
result=match([erp(3,'12','مصنع الفجر'),erp(4,'13','مصنع النور',['501234567'])],[nour,fajr],{choices:new Map([[4,'fajr']])});
eq([result.rows.map(o=>o.conflict),result.summary.conflicts],[[true,true],2],'choosing a customer another row already ends on is a conflict');
throws(()=>match([erp(3,'12','مصنع النور',['501234567'])],[nour,fajr,badr],{choices:new Map([[3,'badr']])}),/مش من المرشحين/,'a customer that is not a candidate cannot be chosen');
throws(()=>match([erp(3,'12','مصنع الأمل')],[nour],{choices:new Map([[3,'nour']])}),/لا يقبل/,'a row with no candidates takes no choice');
throws(()=>match([erp(3,'12','مصنع النور')],[nour],{choices:new Map([[9,'nour']])}),/غير موجود/,'a choice for a row not in the file');
throws(()=>match([{...erp(3,'','مصنع النور'),issue:'no-code'}],[nour],{choices:new Map([[3,'nour']])}),/لا يقبل/,'an invalid row takes no choice');
r=one([{...erp(3,'','مصنع النور'),issue:'no-code'}],[nour]);
eq([r.status,r.issue,r.candidates,r.customerId],['invalid','no-code',[],''],'an invalid row is not matched');

// mapping when the number is held by another customer
const holder=customer('holder',{name:'مصنع قديم',code:'12'});
result=match([erp(3,'12','مصنع النور')],[nour,holder]);
eq([result.rows[0].sharedWith,result.rows[0].mapping,result.plan[0].mapping,result.plan[0].mappingVersion,result.plan[0].codeKey],[1,true,true,0,'12'],'the number is another customer\'s code: a new mapping to this customer');
const aliasHolder=customer('alias',{name:'مصنع سابق',code:'40',_erpCodeAliases:['40','12']});
result=match([erp(3,'12','مصنع النور')],[nour,aliasHolder]);
eq([result.rows[0].sharedWith,result.rows[0].mapping],[1,true],'a number another customer keeps as an old code needs the mapping too');
result=match([erp(3,'12','مصنع النور')],[nour,holder],{mappings:[{codeKey:'12',customerId:'holder',version:4}]});
eq([result.plan[0].mapping,result.plan[0].mappingVersion],[true,4],'a stored mapping to the other customer is moved (its version checked)');
result=match([erp(3,'12','مصنع النور')],[nour,holder],{mappings:[{codeKey:'12',customerId:'nour',version:2}]});
eq([result.rows[0].sharedWith,result.rows[0].mapping],[1,false],'a mapping already pointing to this customer is kept');
result=match([erp(3,'12','مصنع النور')],[nour,fajr]);
eq([result.rows[0].sharedWith,result.rows[0].mapping],[0,false],'nobody else holds the number: no mapping');
const sameTwin=customer('same-twin',{name:'مصنع آخر',code:'C-1'});
result=match([erp(3,'C-1','مصنع النور')],[nour,sameTwin]);
eq([result.rows[0].status,result.rows[0].change,result.plan.map(p=>[p.codeChange,p.mapping])],['same',true,[[false,true]]],'the same code also held by another customer: only the mapping is written');
result=match([erp(3,'12','مصنع النور'),erp(4,'C-1','مصنع الفجر')],[nour,fajr]);
eq(result.plan.map(p=>[p.customerId,p.to,p.mapping]),[['nour','12',false],['fajr','C-1',true]],'a number moving from one customer to another in the same file: the new holder gets the mapping');

// the manager's regions
const east=customer('east',{name:'مصنع الشرق',phone:'0551234567',region:'الشرقية'}),central=customer('central',{name:'مصنع الوسط',phone:'0551234567',region:'الوسطى'});
r=one([erp(3,'12','',['551234567'])],[east],{me:manager});
eq([r.status,r.candidates,r.customerId,r.matchedBy],['out-of-region',[],'',''],'only candidates outside the manager\'s regions: out-of-region, no details');
r=one([erp(3,'12','',['551234567'])],[east,central],{me:manager});
eq([r.status,r.candidates.map(c=>c.id),r.customerId],['choose',['central'],''],'a hidden candidate is never shown, and it still makes the row a choice (nothing guessed)');
throws(()=>match([erp(3,'12','',['551234567'])],[east,central],{me:manager,choices:new Map([[3,'east']])}),/مش من المرشحين/,'a hidden customer cannot be chosen');
throws(()=>match([erp(3,'12','',['551234567'])],[east],{me:manager,choices:new Map([[3,'east']])}),/لا يقبل/,'an out-of-region row takes no choice');
r=one([erp(3,'12','مصنع الوسط')],[east,central],{me:manager});
eq([r.status,r.customerId],['auto','central'],'a unique match inside the regions is automatic');
r=one([erp(3,'12','',['551234567'])],[east,central]);
eq(r.candidates.map(c=>c.id),['east','central'],'the administrator sees both');
result=match([erp(3,'12','',['551234567'])],[east,central],{me:manager});
eq(result.involved,[['central',3],['east',3]],'the snapshot covers every candidate, hidden ones too (server only)');
const regional={...admin,regionScope:'eastern'};
eq(one([erp(3,'12','مصنع الوسط')],[central],{me:regional}).status,'out-of-region','an administrator with regions is limited to them as well');

// summary
result=match([erp(3,'12','مصنع النور'),erp(4,'C-9','مصنع النور'),erp(5,'20','مصنع الأمل'),erp(6,'',''),erp(7,'0','مصنع البدر')].map(row=>row.code?row:{...row,issue:'no-code'}),[nour,twin,badr],{me:admin});
eq(result.summary,{rows:5,auto:1,same:0,choose:2,missing:1,outOfRegion:0,invalid:1,conflicts:0,pending:2,changes:1,codeChanges:1,mappings:0},'the counts');

// ---- the generic sheet reader on synthetic workbooks
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const inline=v=>`<c t="inlineStr"><is><t>${escape(v)}</t></is></c>`,number=v=>`<c><v>${v}</v></c>`;
function book(sheets,extra={}){
 const parts={'[Content_Types].xml':strToU8('<?xml version="1.0"?><Types/>'),'xl/workbook.xml':strToU8(`<workbook xmlns:r="r"><sheets>${sheets.map((s,i)=>`<sheet name="${escape(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`),'xl/_rels/workbook.xml.rels':strToU8(`<Relationships>${sheets.map((s,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}</Relationships>`),...extra};
 sheets.forEach((s,i)=>{parts[`xl/worksheets/sheet${i+1}.xml`]=strToU8(`<worksheet><sheetData>${s.rows.map((cells,r)=>`<row r="${r+1}">${cells.join('')}</row>`).join('')}</sheetData></worksheet>`);});
 return zipSync(parts);
}
const bytes=book([{name:'Notes',rows:[[inline('ملاحظة')]]},{name:'Customer',rows:[[inline('العملاء')],header.map(inline),[number(7),inline(' مصنع النور '),inline('مصنع النور'),'<c t="s"><v>0</v></c>',number(551234567)]]}],{'xl/sharedStrings.xml':strToU8('<sst><si><t>+966551234567</t></si></sst>')});
let sheets=S.readWorkbookSheets(bytes);
eq(sheets.map(s=>[s.name,s.rows.length]),[['Notes',1],['Customer',3]],'every sheet with its name and rows');
eq(sheets[1].rows[2],{rowNumber:3,cells:['7',' مصنع النور '.trim(),'مصنع النور','+966551234567','551234567']},'cells as trimmed text: numbers, inline and shared strings');
parsed=E.erpCustomerRows(sheets);
eq([parsed.sheet,parsed.rows[0].code,parsed.rows[0].phones],['Customer','7',['551234567']],'the export read end to end');
assert.throws(()=>S.readWorkbookSheets(book([{name:'Customer',rows:[[inline('رقم العميل')],['<c><f>1+1</f><v>2</v></c>']]}])),error=>error instanceof S.ErpWorkbookError&&/معادلات/.test(error.message),'formulas are refused as in the sales report');checks++;
assert.throws(()=>S.readWorkbookSheets(book([{name:'Customer',rows:Array.from({length:61},()=>[number(1)])}]),{maxRows:10}),error=>error instanceof S.ErpWorkbookError&&/10/.test(error.message),'the row limit is the caller\'s (with the same 50 rows of room for titles and headers as the sales report)');checks++;
eq(S.readWorkbookSheets(book([{name:'Customer',rows:Array.from({length:60},()=>[number(1)])}]),{maxRows:10})[0].rows.length,60,'up to the limit and its room');
assert.throws(()=>S.readWorkbookSheets(strToU8('not a zip file at all, not even close')),error=>error instanceof S.ErpWorkbookError,'a file that is not XLSX');checks++;
assert.throws(()=>S.parseErpWorkbook(bytes),error=>error instanceof S.ErpWorkbookError,'the sales parser still refuses a customer file');checks++;
eq(S.readWorkbookSheets(book([{name:'Customer',rows:Array.from({length:20050},()=>[number(1),inline('x')])}])).reduce((n,s)=>n+s.rows.length,0),20050,'20 000 rows and a header fit the default limit');

console.log(JSON.stringify({ok:true,checks,scope:'ERP customer import: header detection, phone and name keys, auto/choose/missing/same/out-of-region/invalid, conflicts, choices, mappings, manager regions, plan and summary, generic sheet reader'}));
