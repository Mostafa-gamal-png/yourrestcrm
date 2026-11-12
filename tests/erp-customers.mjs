// The ERP customer import (lib/erp-customers.ts), as pure functions: finding the header of the ERP customer export by its names, the
// phone and name keys, every outcome of matching an ERP row to CRM customers (auto by phone, by name or by both, choose when they point
// to different customers or to several, same, two rows on one customer), the other customers that carry the number and lose it (duplicates, 2026-11-12),
// the manager's regions, the user's choices, and the plan the apply writes; a row found by its code (same / held-outside / choose,
// never added), the similar-name rule (generic words, words many customers carry, at most 5, the regions, nothing preselected, the
// 302-like case), new rows and what they are given, the «عميل جديد» choice and where it is refused, a row without a name, and the
// regions a new customer may get. Also the generic sheet reader (lib/erp-sales.ts
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
eq(['0500000000','0555555555','0511111111','0111111111','+966 1 0000 0000','0123456789','0512345678','٠٥٠٠٠٠٠٠٠٠'].map(phone),[[],[],[],[],[],[],[],[]],'placeholders typed for an unknown number (eight equal digits after the 5 or 1, 0123456789, 0512345678) are nobody\'s number');
eq([phone('0551111111'),phone('0500000001')],[['551111111'],['500000001']],'a real number with repeated digits is still a number');

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
eq(parsed.rows[0],{row:3,code:'7',codeKey:'7',name:'مصنع النور',nameEn:'مصنع النور',phones:['551234567','112345678'],issue:'',contact:{mobile:'+966551234567',phone:'0112345678',email:'',address:'A B C D 1 2 3 4'}},'one row: number, names, both phone columns, and the cells a new customer is given (no ID number, no date)');
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
throws(()=>E.erpCustomerRows([sheet([['رقم الفاتورة','التاريخ','رقم العميل','اسم العميل'],['INV-1','2026/01/01','7','مصنع']])]),/ليس ملف عملاء ERP/,'the ERP sales report is not a customer file');
throws(()=>E.erpCustomerRows([sheet([['رقم العميل','الاسم بالعربي','الاسم بالعربي'],['1','أ','ب']])]),/عمود مكرر/,'a duplicated column is refused');
throws(()=>E.erpCustomerRows([sheet([header])]),/لا يحتوي صفوف/,'a header without rows');
parsed=E.erpCustomerRows([sheet([header,line('20','أ','','0551234567\n0501234567','0112345678'),line('21','ب','','0551234568\r\n0501234568')])]);
eq(parsed.rows.map(r=>r.phones),[['551234567','501234567','112345678'],['551234568','501234568']],'numbers on separate lines of one cell are read one by one, as the cell holds them');
eq(parsed.rows.map(r=>r.contact.mobile),['0551234567 / 0501234567','0551234568 / 0501234568'],'a new customer keeps the cell as text, its lines joined by « / »');
eq(E.phoneKeys(parsed.rows[0].contact.mobile),['551234567','501234567'],'so each number is found again in the saved phone');
parsed=E.erpCustomerRows([sheet([header,['40','100','مصنع','','',' 0551234567 ','  a@b.co ','حي  الصناعية‏','2026/01/01'],['41','100','مصنع آخر','','','','not an email','x'.repeat(300),'']])]);
eq(parsed.rows.map(r=>r.contact),[{mobile:'',phone:'0551234567',email:'a@b.co',address:'حي الصناعية'},{mobile:'',phone:'',email:'not an email',address:'x'.repeat(250)}],'email and address cleaned, the address cut to 250 (the email is checked by the server)');
const many=Array.from({length:6},(_,i)=>'05512345'+(10+i)).join(' / ');
parsed=E.erpCustomerRows([sheet([header,line('22','أ','',many,''),line('23','ب','','0551234567 / 0501234567 / 0561234567','0112345678 / 0112345679'),line('24','ج','','','0'.repeat(201)),line('25','د','','0551234567'+' '.repeat(190),''),line('22','ه','','','')])]);
eq(parsed.rows.map(r=>[r.code,r.issue,r.phones.length]),[['22','duplicate-code',0],['23','',5],['24','too-many-phones',0],['25','',1],['22','duplicate-code',0]],'more than 5 numbers or a phone cell over 200 characters: not read (and still a number of the file, so its twin is a duplicate); 5 numbers and a cell of exactly 200 are read');
parsed=E.erpCustomerRows([sheet([header,line('26','أ','',many,'')])]);
eq([parsed.rows[0].issue,parsed.rows[0].phones],['too-many-phones',[]],'a row with too many numbers keeps none of them');
const titled=[['تقرير العملاء'],['الشركة'],['من 2026/01/01'],['إلى 2026/11/01'],[''],header,line('31','مصنع','','','')];
eq(E.erpCustomerRows([sheet(titled)]).rows.map(r=>r.row),[7],'the header is found under several title rows (row 6 here)');
const deep=[...Array.from({length:24},(_,i)=>['ملاحظة '+(i+1)]),header,line('32','مصنع','','','')];
eq(E.erpCustomerRows([sheet(deep)]).rows.map(r=>r.row),[26],'a header on row 25 is still found');
throws(()=>E.erpCustomerRows([sheet([['ملاحظة'],...deep])]),/ليس ملف عملاء ERP/,'a header below the first 25 rows is not looked for');
throws(()=>E.erpCustomerRows([sheet([header,...Array.from({length:20001},(_,i)=>line(String(i+1),'م','','',''))])]),/20000/,'more than 20 000 customers');
eq(E.erpCustomerRows([sheet([header,...Array.from({length:20000},(_,i)=>line(String(i+1),'م','','',''))])]).rows.length,20000,'20 000 customers are read');

// ---- matching
const admin={id:'owner',role:'admin',regionScope:'all',name:'Owner',email:'o@x',branch:'b',active:1,target:0};
const manager={id:'m1',role:'manager',regionScope:'central',name:'Manager',email:'m@x',branch:'b',active:1,target:0};
let serial=0;
const customer=(id,data)=>({id,kind:'customer',parentId:null,assignedTo:'rep',branch:'b',version:3,createdAt:'',updatedAt:'',data:{name:id,code:'',phone:'',phone2:'',region:'الوسطى',internalCode:'YR-C-'+String(++serial).padStart(6,'0'),...data}});
const noContact={mobile:'',phone:'',email:'',address:''};
const erp=(row,code,arabic,phones=[],english='',contact=noContact)=>({row,code,codeKey:String(code).toUpperCase(),name:arabic,nameEn:english,phones,issue:'',contact});
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
eq([r.status,r.candidates,r.customerId,r.change,r.add,r.matchedBy],['new',[],'',false,true,''],'no customer, no similar name, nobody holds the number: new, added by default');
r=one([erp(3,'c-1','مصنع النور')],[nour,fajr]);
eq([r.status,r.customerId,r.from,r.to,r.change,r.mapping],['same','nour','C-1','c-1',false,false],'the customer already has this number: same, no change');
r=one([erp(3,'12','مصنع النور للبلاستيك',['000'])],[nour]);
eq([r.status,r.customerId,r.add,r.candidates.map(c=>[c.id,c.matchedBy])],['similar','',false,[['nour','similar']]],'a longer name is not a match (only a similar one, nothing preselected) and a broken phone matches nothing');

// two rows ending on one customer
let result=match([erp(3,'12','مصنع النور'),erp(4,'13','',['551234567'])],[nour,fajr]);
eq(result.rows.map(o=>[o.status,o.conflict,o.customerId]),[['choose',true,'nour'],['choose',true,'nour']],'two rows on one customer: both choose, in conflict');
eq([result.summary.conflicts,result.plan.length],[2,0],'nothing is planned while they conflict');
result=match([erp(3,'12','مصنع النور'),erp(4,'C-1','',['551234567'])],[nour,fajr],{choices:new Map([[3,'nour']])});
eq(result.rows.map(o=>[o.status,o.conflict]),[['choose',true],['choose',true]],'a same row and a row chosen for the same customer conflict too');
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
throws(()=>match([erp(3,'12','مصنع النور',['501234567'])],[nour,fajr,badr],{choices:new Map([[3,'badr']])}),/ليس من المرشحين/,'a customer that is not a candidate cannot be chosen');
throws(()=>match([erp(3,'12','مصنع الأمل')],[nour],{choices:new Map([[3,'nour']])}),/لا يقبل/,'a row with no candidates takes no choice');
throws(()=>match([erp(3,'12','مصنع النور')],[nour],{choices:new Map([[9,'nour']])}),/غير موجود/,'a choice for a row not in the file');
throws(()=>match([{...erp(3,'','مصنع النور'),issue:'no-code'}],[nour],{choices:new Map([[3,'nour']])}),/لا يقبل/,'an invalid row takes no choice');
r=one([{...erp(3,'','مصنع النور'),issue:'no-code'}],[nour]);
eq([r.status,r.issue,r.candidates,r.customerId],['invalid','no-code',[],''],'an invalid row is not matched');

// duplicate holders (2026-11-12: «مفيش حد ادى لعميلين نفس الكود»): the row's customer keeps the number alone and every other customer that
// carries it now loses it (`duplicates`); no code mapping is ever planned (mapping stays false)
const holder=customer('holder',{name:'مصنع قديم',code:'12'});
const dup=result=>result.duplicates.map(d=>[d.customerId,d.code,d.row,d.ownerId]);
result=match([erp(3,'12','مصنع النور')],[nour,holder]);
eq([result.rows[0].sharedWith,result.rows[0].mapping,result.plan.map(p=>[p.customerId,p.codeChange,p.mapping]),dup(result),result.summary.duplicates,result.summary.mappings],[1,false,[['nour',true,false]],[['holder','12',3,'nour']],1,0],'the number is another customer\'s code: nour takes it, holder loses it, no mapping');
eq(result.duplicates[0],{customerId:'holder',version:3,name:'مصنع قديم',internalCode:holder.data.internalCode,code:'12',region:'الوسطى',row:3,ownerId:'nour',ownerName:'مصنع النور',ownerInternalCode:nour.data.internalCode},'a duplicate as the preview lists it: name, Yourrest code, region, its code, the row and the customer that keeps it (version for the server)');
const aliasHolder=customer('alias',{name:'مصنع سابق',code:'40',_erpCodeAliases:['40','12']});
result=match([erp(3,'12','مصنع النور')],[nour,aliasHolder]);
eq([result.rows[0].sharedWith,result.plan.map(p=>[p.customerId,p.codeChange,p.mapping]),dup(result)],[0,[['nour',true,false]],[]],'a number another customer only had before is nobody\'s: nobody loses it');
result=match([erp(3,'12','مصنع النور')],[nour,holder],{mappings:[{codeKey:'12',customerId:'holder',version:4}]});
eq([result.rows[0].status,result.plan.map(p=>[p.customerId,p.mapping,p.mappingVersion]),dup(result)],['auto',[['nour',false,0]],[['holder','12',3,'nour']]],'the row\'s exact name decides over a stored mapping to the other holder: holder loses the number, the mapping row is not written (it decides nothing once holder no longer carries the number)');
result=match([erp(3,'12','مصنع النور')],[nour,holder],{mappings:[{codeKey:'12',customerId:'nour',version:2}]});
eq([result.rows[0].sharedWith,result.rows[0].mapping,dup(result)],[1,false,[['holder','12',3,'nour']]],'a mapping to a customer that does not carry the number yet changes nothing: holder still loses it');
result=match([erp(3,'12','مصنع النور')],[nour,fajr]);
eq([result.rows[0].sharedWith,dup(result),result.summary.duplicates],[0,[],0],'nobody else holds the number: nobody loses it');
const sameTwin=customer('same-twin',{name:'مصنع آخر',code:'C-1'});
result=match([erp(3,'C-1','مصنع النور')],[nour,sameTwin]);
eq([result.rows[0].status,result.rows[0].change,result.plan,dup(result)],['same',false,[],[['same-twin','C-1',3,'nour']]],'the same code also held by another customer: nour keeps it unchanged, the twin loses it');
result=match([erp(3,'C-1','مصنع النور')],[nour,sameTwin],{choices:new Map([[3,'']])});
eq([result.rows[0].customerId,dup(result)],['',[]],'a row left clears nobody');
result=match([erp(3,'12','مصنع النور'),erp(4,'C-1','مصنع الفجر')],[nour,fajr],{choices:new Map([[3,'nour']])});
eq([result.plan.map(p=>[p.customerId,p.to,p.mapping]),dup(result)],[[['nour','12',false],['fajr','C-1',false]],[]],'a number moving from one customer to another in the same file: the old holder takes its own new number, so it is no duplicate');
// ambiguous: two holders and nothing in the row decides; the importer chooses, and nothing is cleared until then
const holderA=customer('holder-a',{name:'مصنع ألف',code:'103'}),holderB=customer('holder-b',{name:'مصنع باء',code:'103'});
result=match([erp(5,'103','اسم لا يطابق أحدًا')],[holderA,holderB]);
eq([result.rows[0].status,result.rows[0].customerId,result.rows[0].candidates.map(c=>[c.id,c.matchedBy]),dup(result),result.summary.pending],['choose','',[['holder-a','code'],['holder-b','code']],[],1],'two holders and a name that decides nothing: the importer chooses, nobody is cleared yet');
result=match([erp(5,'103','اسم لا يطابق أحدًا')],[holderA,holderB],{choices:new Map([[5,'holder-b']])});
eq([result.rows[0].customerId,result.plan,dup(result)],['holder-b',[],[['holder-a','103',5,'holder-b']]],'the importer\'s choice keeps the number and clears the other holder');
result=match([erp(5,'103','اسم لا يطابق أحدًا')],[holderA,holderB],{mappings:[{codeKey:'103',customerId:'holder-a',version:7}]});
eq([result.rows[0].status,result.rows[0].customerId,dup(result)],['same','holder-a',[['holder-b','103',5,'holder-a']]],'a stored mapping to one of the holders is the choice: the other holder loses the number');
result=match([erp(5,'103','مصنع ألف')],[holderA,holderB]);
eq([result.rows[0].status,result.rows[0].customerId,dup(result)],['same','holder-a',[['holder-b','103',5,'holder-a']]],'the row\'s name decides between the holders');
const holderA2=customer('holder-a2',{name:'مصنع ألف',code:'103'});
result=match([erp(5,'103','مصنع ألف')],[holderA,holderA2,holderB]);
eq([result.rows[0].status,result.rows[0].customerId,dup(result)],['choose','',[]],'two holders with the row\'s name: a choice, nobody cleared');
result=match([erp(5,'103','مصنع ألف')],[holderA,holderA2,holderB],{mappings:[{codeKey:'103',customerId:'holder-a2',version:1}]});
eq([result.rows[0].status,result.rows[0].customerId,dup(result).map(d=>d[0])],['same','holder-a2',['holder-a','holder-b']],'among holders with the row\'s name, the stored mapping picks one: both others lose the number');

// the manager's regions
const east=customer('east',{name:'مصنع الشرق',phone:'0551234567',region:'الشرقية'}),central=customer('central',{name:'مصنع الوسط',phone:'0551234567',region:'الوسطى'});
r=one([erp(3,'12','',['551234567'])],[east],{me:manager});
eq([r.status,r.candidates,r.customerId,r.matchedBy],['out-of-region',[],'',''],'only candidates outside the manager\'s regions: out-of-region, no details');
r=one([erp(3,'12','',['551234567'])],[east,central],{me:manager});
eq([r.status,r.candidates.map(c=>c.id),r.customerId],['choose',['central'],''],'a hidden candidate is never shown, and it still makes the row a choice (nothing guessed)');
throws(()=>match([erp(3,'12','',['551234567'])],[east,central],{me:manager,choices:new Map([[3,'east']])}),/ليس من المرشحين/,'a hidden customer cannot be chosen');
throws(()=>match([erp(3,'12','',['551234567'])],[east],{me:manager,choices:new Map([[3,'east']])}),/لا يقبل/,'an out-of-region row takes no choice');
r=one([erp(3,'12','مصنع الوسط')],[east,central],{me:manager});
eq([r.status,r.customerId],['auto','central'],'a unique match inside the regions is automatic');
r=one([erp(3,'12','',['551234567'])],[east,central]);
eq(r.candidates.map(c=>c.id),['east','central'],'the administrator sees both');
result=match([erp(3,'12','',['551234567'])],[east,central],{me:manager});
eq(result.involved,[['central',3],['east',3]],'the snapshot covers every candidate, hidden ones too (server only)');
const regional={...admin,regionScope:'eastern'};
eq(one([erp(3,'12','مصنع الوسط')],[central],{me:regional}).status,'out-of-region','an administrator with regions is limited to them as well');
// a number a customer outside the manager's regions carries: left for the system administrator (the import would clear it from that customer)
const eastHolder=customer('east-holder',{name:'مصنع شرقي',code:'12',region:'الشرقية'}),hidden=customer('hidden',{name:'مصنع مخفي',code:'OLD',_erpCodeAliases:['OLD','12'],region:'الشرقية'});
result=match([erp(3,'12','مصنع الوسط')],[central,eastHolder],{me:manager});
eq([result.rows[0].status,result.rows[0].candidates,result.rows[0].customerId,result.rows[0].sharedWith,result.plan,dup(result),result.summary.heldOutside],['held-outside',[],'',0,[],[],1],'the number is the current code of a customer outside the manager\'s regions: nothing planned or cleared, no details');
ok(result.involved.some(([id])=>id===eastHolder.id),'the outside holder\'s version is part of the preview');
result=match([erp(3,'12','مصنع الوسط')],[central,eastHolder]);
eq([result.rows[0].status,result.plan.map(p=>[p.customerId,p.mapping]),dup(result)],['auto',[['central',false]],[['east-holder','12',3,'central']]],'the system administrator does it: central takes the number, the outside holder loses it');
result=match([erp(3,'12','مصنع الوسط')],[central,hidden],{me:manager});
eq([result.rows[0].status,result.rows[0].customerId,result.plan.map(p=>[p.customerId,p.mapping]),dup(result),result.summary.heldOutside],['auto','central',[['central',false]],[],0],'a number a customer outside the regions only had before (a kept alias) holds nothing: the manager links it');
throws(()=>match([erp(3,'12','مصنع الوسط')],[central,eastHolder],{me:manager,choices:new Map([[3,'central']])}),/لا يقبل/,'a held-outside row takes no choice');
const dal=customer('dal',{name:'مصنع دال',code:'OLD-D',_erpCodeAliases:['OLD-D','30']});
result=match([erp(4,'30','مصنع دال')],[dal,east],{me:manager,mappings:[{codeKey:'30',customerId:'east',version:2}]});
eq([result.rows[0].status,result.plan.map(p=>[p.customerId,p.codeChange,p.mapping]),dup(result)],['auto',[['dal',true,false]],[]],'a stored mapping to a customer outside the regions that does not carry the number decides nothing: the manager gives dal the code');
const eastThirty=customer('east-30',{name:'مصنع شرقي ثلاثين',code:'30',region:'الشرقية'});
result=match([erp(4,'30','مصنع دال')],[dal,eastThirty],{me:manager,mappings:[{codeKey:'30',customerId:'east-30',version:2}]});
eq([result.rows[0].status,result.plan,dup(result)],['held-outside',[],[]],'a customer outside the regions that carries the number (mapped to it) is never cleared by the manager');
const dalInside=customer('dal-inside',{name:'مصنع داخلي ثلاثين',code:'30'});
result=match([erp(4,'30','مصنع دال')],[dal,dalInside,east],{me:manager,mappings:[{codeKey:'30',customerId:'east',version:2}]});
eq([result.rows[0].status,result.plan.map(p=>[p.customerId,p.codeChange,p.mapping]),dup(result)],['auto',[['dal',true,false]],[['dal-inside','30',4,'dal']]],'a stale mapping to a customer outside the regions decides nothing and is not rewritten: the manager gives dal the number and clears the holder inside their regions');
const insideHolder=customer('inside-holder',{name:'مصنع داخلي',code:'12'});
result=match([erp(3,'12','مصنع الوسط')],[central,insideHolder,eastHolder],{me:manager,mappings:[{codeKey:'12',customerId:'inside-holder',version:5}]});
eq([result.rows[0].status,result.plan,dup(result)],['held-outside',[],[]],'even with a mapping to a holder inside, a holder outside the regions would lose the number: the administrator\'s');
result=match([erp(3,'12','مصنع الوسط')],[central,insideHolder,eastHolder],{mappings:[{codeKey:'12',customerId:'inside-holder',version:5}]});
eq([result.rows[0].customerId,dup(result).map(d=>d[0])],['central',['east-holder','inside-holder']],'the system administrator: both holders lose it');
const insideTwin=customer('inside-twin',{name:'مصنع آخر',code:'12'});
result=match([erp(3,'12','مصنع الوسط')],[central,insideTwin],{me:manager});
eq([result.rows[0].status,result.plan.map(p=>[p.customerId,p.mapping]),dup(result)],['auto',[['central',false]],[['inside-twin','12',3,'central']]],'a number held only inside the manager\'s regions: the manager clears it as the administrator would');
eq([E.heldOutsideRegions(admin,[eastHolder]),E.heldOutsideRegions(manager,[eastHolder]),E.heldOutsideRegions(manager,[central]),E.heldOutsideRegions(manager,[central,eastHolder]),E.heldOutsideRegions(manager,[])],[false,true,false,true,false],'heldOutsideRegions: never for all regions; any holder outside; only holders inside; nobody');

// too many matches: a phone or name shared by more than 20 customers is not offered
const crowd=(count,data)=>Array.from({length:count},(_,i)=>customer('crowd-'+i,{name:'مصنع رقم '+i,...data}));
r=one([erp(3,'12','',['551234599'])],crowd(21,{phone:'0551234599'}));
eq([r.status,r.issue,r.candidates,r.customerId],['invalid','too-many-matches',[],''],'21 customers with the phone: too many, no candidate list');
r=one([erp(3,'12','',['551234599'])],crowd(20,{phone:'0551234599'}));
eq([r.status,r.candidates.length],['choose',20],'20 customers are still offered');
r=one([erp(3,'12','مصنع مشترك')],crowd(21,{name:'مصنع مشترك'}));
eq([r.status,r.issue],['invalid','too-many-matches'],'21 customers with the name: too many');
r=one([erp(3,'12','مصنع مشترك',['551234599'])],[...crowd(12,{phone:'0551234599'}),...crowd(12,{name:'مصنع مشترك'}).map(c=>({...c,id:c.id+'-n'}))]);
eq([r.status,r.issue],['invalid','too-many-matches'],'12 by phone and 12 by name together: too many');
throws(()=>match([erp(3,'12','',['551234599'])],crowd(21,{phone:'0551234599'}),{choices:new Map([[3,'crowd-0']])}),/لا يقبل/,'a row with too many matches takes no choice');
const wideResult=match([erp(3,'12','',['551234599'])],crowd(21,{phone:'0551234599'}));
eq([wideResult.summary.invalid,wideResult.involved,wideResult.plan],[1,[],[]],'counted as invalid; nothing involved or planned');
const twenty=crowd(20,{phone:'0551234599'}),rowsOf=count=>Array.from({length:count},(_,i)=>erp(i+3,String(i+1),'',['551234599']));
eq(match(rowsOf(2000),twenty).rows.reduce((n,o)=>n+o.candidates.length,0),40000,'40 000 candidates in one preview are offered');
throws(()=>match(rowsOf(2001),twenty),/أكثر من اللازم/,'beyond 40 000 the file is refused, not sent');

// the single candidate's current code is another row of the same file: a choice, not automatic
const amal=customer('amal',{name:'مصنع الامل',phone:'0112345678',code:'12'});
result=match([erp(3,'12','مصنع الأمل للبلاستيك',['559999999']),erp(4,'57','شركة اخرى',['112345678'])],[amal]);
eq(result.rows.map(o=>[o.row,o.status,o.customerId,o.matchedBy,o.codeRow,o.candidates.map(c=>c.id)]),[[3,'same','amal','code',0,['amal']],[4,'choose','','',3,['amal']]],'a shared landline points to a customer whose code is row 3 of the file: the user confirms, the code is not replaced (row 3 finds amal by its code)');
eq([result.plan,result.adds,result.summary.pending],[[],[],1],'nothing planned until then');
result=match([erp(3,'12','مصنع الأمل للبلاستيك',['559999999']),erp(4,'57','شركة اخرى',['112345678'])],[amal],{choices:new Map([[4,'amal']])});
eq([result.rows.map(o=>[o.status,o.conflict]),result.plan],[[['choose',true],['choose',true]],[]],'confirmed while row 3 still ends on amal by its code: the two conflict');
result=match([erp(3,'12','مصنع الأمل للبلاستيك',['559999999']),erp(4,'57','شركة اخرى',['112345678'])],[amal],{choices:new Map([[3,''],[4,'amal']])});
eq([result.rows[1].status,result.rows[1].customerId,result.plan.map(p=>[p.customerId,p.from,p.to]),result.adds],['choose','amal',[['amal','12','57']],[]],'row 3 left: the code changes, and the row found by its code is never added');
result=match([erp(3,'12','مصنع الامل'),erp(4,'57','شركة اخرى',['112345678'])],[amal],{choices:new Map([[4,'amal']])});
eq(result.rows.map(o=>[o.status,o.conflict]),[['choose',true],['choose',true]],'and if the code\'s own row ends on the customer too, the two conflict');
eq(one([erp(4,'57','شركة اخرى',['112345678']),{...erp(3,'12','x'),issue:'duplicate-code'}],[amal]).status,'auto','a code row the file itself marks as invalid does not count');
// The same file again after that apply: amal's code is 57 and 12 only a code it had before, which names nobody since 2026-11-12. Row 3
// finds amal only by a similar name (a suggestion, nothing preselected), row 4 is amal by its phone and current code: no conflict, and the
// rest of the file (a new row) can be applied.
const amalAfter=customer('amal',{name:'مصنع الامل',phone:'0112345678',code:'57',_erpCodeAliases:['12','57']});
result=match([erp(3,'12','مصنع الأمل للبلاستيك',['559999999']),erp(4,'57','شركة اخرى',['112345678']),erp(5,'9020','مصنع جديد كليا')],[amalAfter]);
eq(result.rows.map(o=>[o.row,o.status,o.customerId,o.matchedBy,o.codeRow,o.conflict,o.candidates.map(c=>[c.id,c.matchedBy])]),[[3,'similar','','',0,false,[['amal','similar']]],[4,'same','amal','phone',0,false,[['amal','phone']]],[5,'new','','',0,false,[]]],'re-imported: the old code finds nobody (only a similar name is suggested), the row with amal\'s current code is the same');
eq([result.summary.conflicts,result.summary.pending,result.summary.adds,result.plan],[0,1,1,[]],'no conflict: the new customer can be added');
result=match([erp(3,'12','مصنع الأمل للبلاستيك',['559999999']),erp(4,'57','شركة اخرى',['112345678'])],[amalAfter],{choices:new Map([[3,'amal']])});
eq([result.rows.map(o=>[o.status,o.conflict]),result.plan],[[['similar',true],['choose',true]],[]],'picking amal for the old code again: it conflicts with row 4, as any two rows on one customer');
eq(one([erp(3,'12','مصنع الأمل للبلاستيك')],[amalAfter]).status,'similar','the old code alone in the file: amal is not found by it, only suggested by a similar name');
// The YR-C-000302 flow: 302 holds 345, ERP row 345 is another customer, ERP row 9001 is 302 under a close name.
const flow=[erp(3,'345','اسم تاني خالص'),erp(4,'9001','مصنع الصفا للبلوك الحديث')],safa302=customer('safa302',{name:'مصنع الصفا للبلوك الاسمنتي',code:'345'});
result=match(flow,[safa302],{choices:new Map([[3,''],[4,'safa302']])});
eq([result.summary.conflicts,result.plan.map(p=>[p.customerId,p.from,p.to])],[0,[['safa302','345','9001']]],'302: row 345 left and «هو نفسه» on 9001 plans 345 → 9001');
result=match(flow,[{...safa302,data:{...safa302.data,code:'9001',_erpCodeAliases:['345','9001']}}]);
eq([result.rows.map(o=>[o.status,o.customerId,o.matchedBy,o.codeRow]),result.summary.conflicts,result.plan,result.summary.adds],[[['new','','',0],['same','safa302','code',0]],0,[],1],'302 re-imported: 9001 is the same; 345, only 302\'s old code now, is the other ERP customer it is (a new customer), no conflict');

// among several candidates, the one already holding exactly this number is preselected as unchanged
result=match([erp(3,'C-9','مصنع النور')],[nour,twin]);
eq([result.rows[0].status,result.rows[0].customerId,result.rows[0].change,result.rows[0].candidates.map(c=>c.id),result.summary.pending,result.plan],['same','twin',false,['nour','twin'],0,[]],'the twin already holding C-9: no change, the other candidate still listed');
result=match([erp(3,'C-9','مصنع النور')],[nour,twin],{choices:new Map([[3,'nour']])});
eq([result.rows[0].status,result.rows[0].customerId,result.plan.map(p=>[p.customerId,p.to,p.mapping]),dup(result)],['choose','nour',[['nour','C-9',false]],[['twin','C-9',3,'nour']]],'the user may still pick the other one: it takes the number and the twin loses it');
eq(one([erp(3,'C-9','مصنع النور')],[nour,twin,{...twin,id:'twin2',data:{...twin.data,internalCode:'YR-C-999999'}}]).status,'choose','two candidates holding the number: still a choice');

// summary
result=match([erp(3,'12','مصنع النور'),erp(4,'C-9','مصنع النور'),erp(5,'20','مصنع الأمل'),erp(6,'',''),erp(7,'0','مصنع البدر')].map(row=>row.code?row:{...row,issue:'no-code'}),[nour,twin,badr],{me:admin});
eq(result.summary,{rows:5,auto:1,same:1,choose:1,similar:0,new:1,outOfRegion:0,heldOutside:0,invalid:1,conflicts:0,pending:1,changes:1,codeChanges:1,mappings:0,adds:1,duplicates:0},'the counts');

// ---- by the code: a row with no phone or name match whose number the CRM already knows is found by it, and never added
const ADD=E.ERP_ADD_CUSTOMER;
eq([typeof ADD,ADD.length>0,/^[A-Za-z0-9_-]+$/.test(ADD)],['string',true,false],'the «عميل جديد» choice is a value no record id has');
const coded=customer('coded',{name:'مصنع مختلف تماما',code:'345'});
result=match([erp(3,'345','اسم تاني خالص',['559000001'])],[coded,nour]);
eq([result.rows[0].status,result.rows[0].matchedBy,result.rows[0].customerId,result.rows[0].change,result.rows[0].add,result.rows[0].candidates.map(c=>[c.id,c.matchedBy]),result.plan,result.adds],['same','code','coded',false,false,[['coded','code']],[],[]],'by code: the only holder is preselected as same, nothing to change, nothing added');
ok(result.involved.some(([id])=>id==='coded'),'the holder is part of the preview\'s snapshot');
const aliased=customer('aliased',{name:'مصنع باسم جديد',code:'NEW-9',_erpCodeAliases:['NEW-9','345b']});
result=match([erp(3,'345b','اسم تاني خالص')],[aliased]);
eq([result.rows[0].status,result.rows[0].customerId,result.rows[0].add,result.rows[0].candidates,result.plan,result.adds.map(a=>a.code)],['new','',true,[],[],['345b']],'a number a customer only had before finds nobody (2026-11-12): with no phone or name match the row is a new customer');
throws(()=>match([erp(3,'345b','اسم تاني خالص')],[aliased],{choices:new Map([[3,'aliased']])}),/لا يقبل/,'the customer that had the number before is no candidate');
result=match([erp(3,'345b','مصنع باسم جديد')],[aliased],{choices:new Map([[3,'aliased']])});
eq(result.plan.map(p=>[p.customerId,p.from,p.to,p.codeChange,p.mapping]),[['aliased','NEW-9','345b',true,false]],'found by its name and picked: the customer takes the number again');
const twinCodeA=customer('code-a',{name:'مصنع ألف',code:'347'}),twinCodeB=customer('code-b',{name:'مصنع باء',code:'B-1',_erpCodeAliases:['B-1','347']});
result=match([erp(3,'347','اسم تاني خالص')],[twinCodeA,twinCodeB]);
eq([result.rows[0].status,result.rows[0].customerId,result.rows[0].candidates.map(c=>[c.id,c.matchedBy]),result.summary.pending,result.plan,result.adds],['same','code-a',[['code-a','code']],0,[],[]],'one current holder and one that only had the number before: the current holder alone, never added');
throws(()=>match([erp(3,'347','اسم تاني خالص')],[twinCodeA,twinCodeB],{choices:new Map([[3,'code-b']])}),/ليس من المرشحين/,'the customer that had the number before cannot be picked for it');
result=match([erp(3,'347','اسم تاني خالص')],[twinCodeA,twinCodeB],{mappings:[{codeKey:'347',customerId:'code-b',version:2}]});
eq([result.rows[0].status,result.rows[0].customerId,result.plan],['same','code-a',[]],'a stored mapping to the customer that had the number before is ignored: the current holder wins');
const twinCodeC=customer('code-c',{name:'مصنع جيم',code:'347'});
result=match([erp(3,'347','اسم تاني خالص')],[twinCodeA,twinCodeC]);
eq([result.rows[0].status,result.rows[0].customerId,result.rows[0].candidates.map(c=>[c.id,c.matchedBy]),result.summary.pending,result.plan,result.adds],['choose','',[['code-a','code'],['code-c','code']],1,[],[]],'two current holders of the number: choose among them, never added');
result=match([erp(3,'347','اسم تاني خالص')],[twinCodeA,twinCodeC],{choices:new Map([[3,'code-c']])});
eq([result.rows[0].status,result.plan,dup(result)],['choose',[],[['code-a','347',3,'code-c']]],'a pick among current holders: nothing to change for it, the other holder loses the number (no mapping)');
result=match([erp(3,'347','اسم تاني خالص')],[twinCodeA,twinCodeC],{mappings:[{codeKey:'347',customerId:'code-c',version:2}]});
eq([result.rows[0].status,result.rows[0].customerId,result.plan,dup(result)],['same','code-c',[],[['code-a','347',3,'code-c']]],'a stored mapping decides between the current holders: same, and the other holder loses the number');
const eastCoded=customer('east-coded',{name:'مصنع شرقي بعيد',code:'348',region:'الشرقية'});
result=match([erp(3,'348','اسم تاني خالص')],[eastCoded,central],{me:manager});
eq([result.rows[0].status,result.rows[0].candidates,result.rows[0].customerId,result.rows[0].add,result.plan,result.adds],['held-outside',[],'',false,[],[]],'a number held outside the manager\'s regions: held-outside, no details, never added');
ok(result.involved.some(([id])=>id==='east-coded'),'the outside holder is still part of the snapshot');
throws(()=>match([erp(3,'348','اسم تاني خالص')],[eastCoded],{me:manager,choices:new Map([[3,ADD]])}),/لا يقبل/,'and takes no «عميل جديد»');
for(const [label,rows,customers] of [['auto',[erp(3,'12','مصنع النور')],[nour,fajr]],['same',[erp(3,'C-1','مصنع النور')],[nour]],['choose',[erp(3,'12','مصنع النور',['501234567'])],[nour,fajr]],['by code',[erp(3,'345','اسم تاني خالص')],[coded]]])
 throws(()=>match(rows,customers,{choices:new Map([[3,ADD]])}),/ليس عميلًا جديدًا/,'«عميل جديد» is refused on a row the CRM already has: '+label);

// ---- similar names: the rule
const words=E.similarNameTokens;
eq(words('مؤسسة الصفاء للبلوك والتسويق'),['صفا','بلوك'],'generic words dropped, «ال»/«لل»/«و» and a final «ء» taken off');
eq([words('شركة النور للتجارة'),words('مصنع النور التجارية'),words('مصانع النور للصناعة المحدودة')],[['نور'],['نور'],['نور']],'«شركة … للتجارة», «مصنع … التجارية» and «مصانع … للصناعة المحدودة» all read as «نور»');
eq([words('عبد الله'),words('عبدالله')],[['عبدالله'],['عبدالله']],'«عبد الله» and «عبدالله» are one word');
eq(words('Al Noor Trading Co. Ltd'),['al','noor'],'English generic words too, in lower case');
eq([words('مصنع'),words('شركة ذ م م'),words('')],[[],[],[]],'a name of generic or one-letter words only has no distinctive word');
eq(words('م'.repeat(3)+' '+Array.from({length:20},(_,i)=>'كلمه'+i).join(' ')).length,E.ERP_SIMILAR_MAX_WORDS,'a name is read as at most 12 words (bounded)');
const sim=E.nameSimilarity;
eq(sim(['صفا','بلوك'],['صفا','بلوك','حديث']),2/3,'one word added: similar, scored by the words shared');
eq(sim(['صفا','بلوك','حديث'],['صفا','بلوك','اسمنتي']),2/4,'one word replaced: similar');
eq(sim(['نور'],['نور']),1,'the same words (the names differ only in generic words): 1');
eq(sim(['نور'],['فجر']),0,'no word shared: not similar');
eq(sim(['صفا'],['صفا','بلوك','حديث']),0,'two words more on one side: not similar');
eq(sim(['صفا','نور','بدر'],['صفا','فجر','قمر']),0,'two words different: not similar');
eq(sim(['ab','cd'],['ab','ef']),0,'a single short shared word never makes two names similar');
eq([sim([],['نور']),sim(['نور'],[])],[0,0],'nothing to compare');
eq(sim(['محمد','علي','غامدي'],['خالد','فهد','غامدي'],()=>0),0,'on the whole lists: two words different stays not similar, however common those words are');
eq([sim(['صفا','بلوك'],['صفا','بلوك','حديث'],()=>21),sim(['صفا','بلوك'],['صفا','بلوك','حديث'],()=>20)],[0,2/3],'the shared words are evidence only when at most 20 customers carry all of them');
eq(sim(['محمد','علي'],['محمد','علي'],()=>500),1,'the same words are similar however many customers carry them (the names differ only in generic words)');

// ---- similar names in the matcher: offered with nothing preselected; the 302-like case
const c302=customer('c302',{name:'مصنع الصفا للبلوك الاسمنتي',code:'345',phone:'0551110000'});
result=match([erp(3,'9001','مصنع الصفا للبلوك الحديث',['559990000'])],[c302,nour,fajr]);
eq([result.rows[0].status,result.rows[0].customerId,result.rows[0].chosen,result.rows[0].add,result.rows[0].matchedBy,result.rows[0].candidates.map(c=>[c.id,c.matchedBy,c.code]),result.plan,result.adds,result.summary.pending,result.summary.similar],['similar','',false,false,'',[['c302','similar','345']],[],[],1,1],'the 302 case: one word different is similar, not new; nothing preselected, nothing planned or added until the user chooses');
ok(result.involved.some(([id])=>id==='c302'),'a similar candidate is part of the snapshot');
result=match([erp(3,'9001','مصنع الصفا للبلوك الحديث')],[c302],{choices:new Map([[3,'c302']])});
eq([result.rows[0].status,result.rows[0].customerId,result.rows[0].chosen,result.rows[0].matchedBy,result.plan.map(p=>[p.customerId,p.from,p.to,p.codeChange,p.mapping]),result.adds],['similar','c302',true,'similar',[['c302','345','9001',true,false]],[]],'«هو نفسه»: the customer takes the ERP code, like a choose pick');
result=match([erp(3,'9001','مصنع الصفا للبلوك الحديث',[],'',{mobile:'0559990000',phone:'',email:'safa@example.invalid',address:'حي'})],[c302],{choices:new Map([[3,ADD]])});
eq([result.rows[0].status,result.rows[0].add,result.rows[0].chosen,result.rows[0].customerId,result.plan,result.adds],['similar',true,true,'',[],[{row:3,code:'9001',codeKey:'9001',name:'مصنع الصفا للبلوك الحديث',phone:'0559990000',phone2:'',email:'safa@example.invalid',address:'حي'}]],'«عميل جديد»: the row is added with its cells');
result=match([erp(3,'9001','مصنع الصفا للبلوك الحديث')],[c302],{choices:new Map([[3,'']])});
eq([result.rows[0].chosen,result.rows[0].add,result.plan,result.adds,result.summary.pending],[true,false,[],[],0],'«اتركه»: nothing changes, nothing is added');
throws(()=>match([erp(3,'9001','مصنع الصفا للبلوك الحديث')],[c302,nour],{choices:new Map([[3,'nour']])}),/ليس من المرشحين/,'a customer that is not a similar candidate cannot be picked');
eq(one([erp(3,'9002','مصنع النور')],[fajr]).status,'new','«مصنع النور» and «مصنع الفجر» are not similar');
eq(one([erp(3,'9002','مؤسسة الفجر للتجارة')],[fajr]).candidates.map(c=>c.id),['fajr'],'«مؤسسة الفجر للتجارة» and «مصنع الفجر» differ only in generic words: similar');
// ranked by score, at most 5, none from outside the regions
const safa=[customer('s1',{name:'مصنع الصفا'}),customer('s2',{name:'مصنع الصفا للبلوك الحديث'}),customer('s3',{name:'مؤسسة الصفا للبلوك'}),customer('s4',{name:'مصنع الصفا للبلوك القديم'})];
eq(one([erp(3,'9003','مصنع الصفا للبلوك')],safa).candidates.map(c=>c.id),['s3','s2','s4','s1'],'ranked by score: the same words (s3, 1), one word added (s2 and s4, 2/3, by Yourrest code), one word of two dropped (s1, 1/2)');
const blocks=count=>Array.from({length:count},(_,i)=>customer('blk-'+i,{name:'مصنع النجم'+i+' للبلوك'}));
r=one([erp(3,'9004','مصنع القمر للبلوك')],blocks(20));
eq([r.status,r.candidates.length,r.candidates.map(c=>c.id)],['similar',5,['blk-0','blk-1','blk-2','blk-3','blk-4']],'twenty customers share «بلوك» and one other word each: at most 5 suggestions');
r=one([erp(3,'9004','مصنع القمر للبلوك')],blocks(21));
eq([r.status,r.candidates],['new',[]],'a word more than 20 customers carry is ignored: «مصنع القمر للبلوك» is new');
const moons=count=>Array.from({length:count},(_,i)=>customer('moon-'+i,{name:'مصنع القمر نجم'+i+' للبلوك'}));
eq(one([erp(3,'9004','مصنع القمر للبلوك الحديث')],moons(20)).candidates.length,5,'twenty customers carry «قمر» and «بلوك» together: still evidence');
eq(one([erp(3,'9004','مصنع القمر للبلوك الحديث')],moons(21)).status,'new','more than twenty carry both together: those shared words are no evidence either');
// Common words are left out of the evidence only: the one-word rule and the score always see the whole names.
const commonWords=(word,count)=>Array.from({length:count},(_,i)=>customer(word+'-'+i,{name:'مصنع '+word+' نجم'+i}));
const crowded=[...commonWords('محمد',25),...commonWords('بلوك',25),...commonWords('علي',25),...commonWords('خالد',25),...commonWords('فهد',25)];
const block345=customer('block345',{name:'مصنع محمد للبلوك',code:'345'});
for(const [label,customers] of [['alone',[block345]],['with 25 customers carrying each of its words',[block345,...crowded]]]){
 result=match([erp(3,'9001','مصنع محمد للبلوك والخرسانة')],customers);
 eq([result.rows[0].status,result.rows[0].add,result.rows[0].candidates[0]?.id,result.summary.adds],['similar',false,'block345',0],'«مصنع محمد للبلوك» and «مصنع محمد للبلوك والخرسانة» (one word added) are similar, '+label+': never added by default');
}
const mohamedAli=customer('mohamed-ali',{name:'محمد علي',code:'346'});
for(const [label,customers] of [['alone',[mohamedAli]],['with both words common',[mohamedAli,...crowded]]])
 eq([one([erp(3,'9002','مؤسسة محمد علي')],customers).status,one([erp(3,'9002','مؤسسة محمد علي')],customers).candidates.map(c=>c.id)],['similar',['mohamed-ali']],'«محمد علي» and «مؤسسة محمد علي» (a generic word apart) are similar, '+label);
const ghamdi=customer('ghamdi',{name:'مؤسسة خالد فهد الغامدي',code:'347'});
for(const [label,customers] of [['alone',[ghamdi]],['with محمد, علي, خالد and فهد common',[ghamdi,...crowded]]]){
 r=one([erp(3,'7001','مؤسسة محمد علي الغامدي')],customers);
 eq([r.status,r.candidates,r.add],['new',[],true],'«مؤسسة محمد علي الغامدي» and «مؤسسة خالد فهد الغامدي» differ in two words: not similar, '+label+' (common words never make names look closer)');
}
eq(one([erp(3,'9005','مصنع الصفا للبلوك الحديث')],[{...safa[2],data:{...safa[2].data,region:'الشرقية'}},safa[3]],{me:manager}).candidates.map(c=>c.id),['s4'],'only customers inside the manager\'s regions are offered');
const eastSafa={...safa[2],data:{...safa[2].data,region:'الشرقية'}};
result=match([erp(3,'9005','مصنع الصفا للبلوك الحديث')],[eastSafa],{me:manager});
eq([result.rows[0].status,result.rows[0].matchedBy,result.rows[0].candidates,result.rows[0].customerId,result.rows[0].add,result.adds,result.summary.adds,result.summary.outOfRegion],['out-of-region','similar',[],'',false,[],0,1],'a similar customer only outside the regions is never shown, and the row is not added either (out-of-region, like a phone or name match there)');
ok(result.involved.some(([id])=>id==='s3'),'the outside similar customer is part of the snapshot');
throws(()=>match([erp(3,'9005','مصنع الصفا للبلوك الحديث')],[eastSafa],{me:manager,choices:new Map([[3,ADD]])}),/لا يقبل/,'and it takes no «عميل جديد» from the manager');
eq([one([erp(3,'9005','مصنع الصفا للبلوك الحديث')],[eastSafa]).status,one([erp(3,'9005','مصنع الصفا للبلوك الحديث')],[eastSafa]).candidates.map(c=>c.id)],['similar',['s3']],'the system administrator sees it as similar');
eq(one([erp(3,'9005','مصنع الصفا للبلوك الحديث')],[eastSafa,customer('far',{name:'مصنع بعيد تماما',region:'الشرقية'})],{me:manager}).status,'out-of-region','an unrelated outside customer changes nothing');
eq(one([erp(3,'9005','مصنع جديد كليا')],[eastSafa],{me:manager}).status,'new','no similar name anywhere: the manager adds it');
// conflicts with a similar pick
result=match([erp(3,'12','مصنع النور'),erp(4,'9006','مصنع النور للبلاستيك')],[nour],{choices:new Map([[4,'nour']])});
eq([result.rows.map(o=>[o.status,o.conflict,o.customerId]),result.summary.conflicts,result.plan],[[['choose',true,'nour'],['similar',true,'nour']],2,[]],'a similar pick on a customer another row ends on: both conflict, the similar row keeps its «عميل جديد»');
result=match([erp(3,'12','مصنع النور'),erp(4,'9006','مصنع النور للبلاستيك')],[nour],{choices:new Map([[3,''],[4,'nour']])});
eq([result.summary.conflicts,result.plan.map(p=>[p.row,p.customerId,p.to])],[0,[[4,'nour','9006']]],'one of them left: the similar pick is planned');

// ---- new customers
result=match([erp(3,'9010','مصنع جديد كليا',['551112222'],'',{mobile:'0551112222',phone:'011 222 3333',email:'new@example.invalid',address:'الرياض'})],[nour]);
eq([result.rows[0].status,result.rows[0].add,result.rows[0].chosen,result.rows[0].customerId,result.summary.new,result.summary.adds,result.summary.pending],['new',true,false,'',1,1,0],'not in the CRM: new, added by default, nothing to choose');
eq(result.adds,[{row:3,code:'9010',codeKey:'9010',name:'مصنع جديد كليا',phone:'0551112222',phone2:'011 222 3333',email:'new@example.invalid',address:'الرياض'}],'what is added: name, code, phones as text, email and address');
ok(!JSON.stringify(result.rows).includes('0551112222')&&!JSON.stringify(result.rows).includes('new@example')&&!JSON.stringify(result.rows).includes('الرياض'),'the preview rows carry no phone, email or address of a new customer');
result=match([erp(3,'9010','مصنع جديد كليا')],[nour],{choices:new Map([[3,'']])});
eq([result.rows[0].status,result.rows[0].add,result.rows[0].chosen,result.adds,result.summary.adds],['new',false,true,[],0],'«اتركه» on a new row: not added');
eq(match([erp(3,'9010','مصنع جديد كليا')],[nour],{choices:new Map([[3,ADD]])}).adds.length,1,'«عميل جديد» on a new row is the default, said again');
throws(()=>match([erp(3,'9010','مصنع جديد كليا')],[nour],{choices:new Map([[3,'nour']])}),/لا يقبل/,'a new row takes no customer');
eq(match([erp(3,'9011','','',  'New Plastic Factory')].map(row=>({...row,phones:[]})),[]).adds.map(a=>a.name),['New Plastic Factory'],'no Arabic name: the English one');
eq(match([erp(3,'9012','م'.repeat(300))],[]).adds[0].name.length,250,'a name is cut to the form\'s 250 characters');
r=one([erp(3,'9013','',[])],[nour]);
eq([r.status,r.issue,r.add,r.candidates],['invalid','no-name',false,[]],'a row with no name and nothing found: invalid (no name), never added');
throws(()=>match([erp(3,'9013','',[])],[nour],{choices:new Map([[3,ADD]])}),/لا يقبل/,'and takes no «عميل جديد»');
eq(one([erp(3,'9014','',['551234567'])],[nour]).status,'auto','a row with no name is still found by its phone');
r=one([{...erp(3,'9015','مصنع مكرر'),issue:'duplicate-code'}],[]);
eq([r.status,r.add],['invalid',false],'a number twice in the file is never added');
eq(one([erp(3,'9016','مصنع الشرق')],[east],{me:manager}).status,'out-of-region','a customer found outside the regions is not added either');
const fileRows=E.erpCustomerRows([sheet([header,line('50','مصنع واحد','','0551230001',''),line('51','مصنع اتنين','','',''),line('','بلا رقم','','',''),line('50','مكرر','','','')])]).rows;
eq(match(fileRows,[]).rows.map(o=>[o.row,o.status,o.add]),[[2,'invalid',false],[3,'new',true],[4,'invalid',false],[5,'invalid',false]],'an empty CRM: every valid row with a name is new, the rest invalid');

// ---- the regions a new customer may get
eq(E.erpNewCustomerRegions(admin),{regions:['','الوسطى','الشرقية','الغربية','الشمالية','الجنوبية'],default:''},'all regions: «المنطقة غير محددة» by default');
eq(E.erpNewCustomerRegions(manager),{regions:['الوسطى'],default:'الوسطى'},'a manager of one region: that region');
eq(E.erpNewCustomerRegions({...manager,regionScope:'central,eastern,unassigned'}),{regions:['','الوسطى','الشرقية'],default:''},'several regions with «غير محددة»: unassigned by default');
eq(E.erpNewCustomerRegions({...manager,regionScope:'eastern,western'}),{regions:['الشرقية','الغربية'],default:'الشرقية'},'several regions without it: the first');

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


// ---- 2026-11-09: the customers the file does not name (`clears`, «امسح كود ERP للعملاء غير الموجودين في الشيت»)
{
 const cl=(id,data)=>customer('clear-'+id,data);
 const byPhone=cl('phone',{name:'مصنع الهاتف',phone:'0551110001',code:'P-OLD'});             // named by phone → gets the sheet's code, not cleared
 const byName=cl('name',{name:'مصنع الاسم',code:'71'});                                          // named by name, same code
 const absent=cl('absent',{name:'مصنع مش في الشيت',code:'K-1'});                                 // nobody names it → cleared
 const empty=cl('empty',{name:'مصنع من غير كود'});                                               // no code → never listed
 const blank=cl('blank',{name:'مصنع كود فاضي',code:'   '});                                     // a blank code reads as none
 const alias=cl('alias',{name:'مصنع قديم جدا',code:'F-1',_erpCodeAliases:['F-1','72']});         // had row 72's number before (a kept old code): named by nothing since 2026-11-12 → cleared
 const current=cl('current',{name:'مصنع كوده في الملف',code:'73'});                              // its code is a row the file gives to another customer
 const mapped=cl('mapped',{name:'مصنع مربوط',code:'H-1'});                                       // a stored mapping of row 74's number, which it does not carry: ignored → cleared
 const similar=cl('similar',{name:'مصنع الياسمين',code:'S-1'});                                  // only a similar name of row 75
 const east=cl('east',{name:'مصنع شرقي بعيد',code:'J-1',region:'الشرقية'});                      // nobody names it; outside the manager's regions
 const dup=cl('dup',{name:'مصنع مكرر الرقم',phone:'0551110002',code:'D-1'});                     // the phone of a row the file itself marks invalid
 const crowd=Array.from({length:21},(_,i)=>cl('crowd-'+i,{name:'مصنع زحمة',code:'Z-'+i}));       // the name of a row too wide to offer
 const other=cl('other',{name:'مصنع تاني',phone:'0551110003'});
 const all=[byPhone,byName,absent,empty,blank,alias,current,mapped,similar,east,dup,...crowd,other];
 const rows=[erp(3,'70','مصنع الهاتف الجديد',['551110001']),erp(4,'71','مصنع الاسم'),erp(5,'72','صف برقم قديم'),erp(6,'73','مصنع تاني',['551110003']),erp(7,'74','سطر ربط بالرقم'),
  erp(8,'75','مصنع الياسمين للبلوك'),{...erp(9,'76','',['551110002']),issue:'duplicate-code'},{...erp(10,'76',''),issue:'duplicate-code'},erp(11,'77','مصنع زحمة')];
 const mappings=[{codeKey:'74',customerId:'clear-mapped',version:1}];
 let found=match(rows,all,{mappings});
 eq(found.clears,[{customerId:'clear-absent',version:3,name:'مصنع مش في الشيت',internalCode:absent.data.internalCode,code:'K-1',region:'الوسطى'},{customerId:'clear-alias',version:3,name:'مصنع قديم جدا',internalCode:alias.data.internalCode,code:'F-1',region:'الوسطى'},{customerId:'clear-mapped',version:3,name:'مصنع مربوط',internalCode:mapped.data.internalCode,code:'H-1',region:'الوسطى'},{customerId:'clear-east',version:3,name:'مصنع شرقي بعيد',internalCode:east.data.internalCode,code:'J-1',region:'الشرقية'}],
  'only the customers no row names in any way and that have a code: not by phone, name, current number, similar name, an invalid row\'s phone or a too-wide row\'s name; a number a customer only had before, or a mapping to a customer that does not carry it, names nobody (2026-11-12)');
 eq(found.rows.find(row=>row.row===3).customerId,'clear-phone','a customer named by phone takes the sheet\'s code as before');
 eq(found.plan.map(step=>step.customerId).includes('clear-absent'),false,'a cleared customer is not part of the plan');
 eq(match(rows,all,{mappings,choices:new Map([[6,''],[8,E.ERP_ADD_CUSTOMER]])}).clears.map(c=>c.customerId),['clear-absent','clear-alias','clear-mapped','clear-east'],'the choices never change the list (a row left, a similar name added as new)');
 eq(match(rows,all,{mappings,choices:new Map([[8,'clear-similar']])}).clears.map(c=>c.customerId),['clear-absent','clear-alias','clear-mapped','clear-east'],'nor a similar name picked');
 eq(match(rows,all,{me:manager,mappings}).clears.map(c=>c.customerId),['clear-absent','clear-alias','clear-mapped'],'a sales manager: only the customers of their regions');
 eq(match(rows,all).clears.map(c=>c.customerId),['clear-absent','clear-alias','clear-mapped','clear-east'],'without the stored mapping: the same (sorted by Yourrest code)');
 const mappedHolder=cl('mapped-holder',{name:'مصنع يحمل الرقم',code:'74'});
 eq(match(rows,[...all,mappedHolder],{mappings:[{codeKey:'74',customerId:'clear-mapped-holder',version:1}]}).clears.map(c=>c.customerId),['clear-absent','clear-alias','clear-mapped','clear-east'],'the current holder of a row\'s number is named by it (and so is a mapped one)');
 eq(match([erp(3,'K-1','اسم تاني')],[absent]).clears,[],'a customer whose current code is a row of the file (found by its code) is not cleared');
 eq(match([erp(3,'99','اسم تاني')],[empty,blank]).clears,[],'customers with no code are never listed');
}

console.log(JSON.stringify({ok:true,checks,scope:'ERP customer import: the customers the file does not name (clears), header detection (also under title rows), phone and name keys (placeholders, numbers on separate lines, bounded cells), auto/choose/same/out-of-region/held-outside/invalid, by code, similar names (rule, common words, max 5, regions, 302-like), new rows, the add choice, no-name rows, new-customer regions, too many matches, a code that is another row, preselected holder, conflicts, choices, duplicate holders that lose the number (a stored mapping as the choice), manager regions and numbers held outside them, plan and summary, generic sheet reader'}));
