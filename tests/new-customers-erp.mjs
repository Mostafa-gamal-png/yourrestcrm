// «العملاء الجدد» from the ERP customers file (the owner, 2026-11-12: «فيه فى داتة العملاء اللى برفعها التاريخ واسم المندوب هاتهم من هنا»),
// as pure functions: «التاريخ» read in every form the ERP writes (2026/11/03, 03/11/2026, an Excel serial, Arabic digits, with a time) and
// refused when it is no day; the date and the representative's column read from a sheet (lib/erp-customer-extras.ts), what a row changes on
// a customer (an empty cell erases nothing, a new name drops the old employee number), the updates of an import; the representative as a
// member (the ERP employee mappings, else one representative's exact full name; «مبيعات مكتب» never); and the KPI (lib/new-customers.ts,
// lib/kpis.ts): by the ERP date and the current responsible, by the file's representative, once when both rules hold, never for office
// sales, never for another month, never for the member who imported, and an ERP date keeps the metric known. Synthetic data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'new-customers-erp-')),seen=new Set();process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
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
for(const file of ['lib/erp-customer-extras.ts','lib/new-customers.ts','lib/kpis.ts','lib/erp-sales.ts'])compile(file);
const X=await import(path.join(out,'lib/erp-customer-extras.mjs')),N=await import(path.join(out,'lib/new-customers.mjs')),K=await import(path.join(out,'lib/kpis.mjs')),S=await import(path.join(out,'lib/erp-sales.mjs'));
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual===undefined?undefined:JSON.parse(JSON.stringify(actual)),expected,message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};
const importsOf=file=>[...fs.readFileSync(path.join(root,file),'utf8').matchAll(/from '([^']+)'/g)].map(match=>match[1]);
ok(!importsOf('lib/new-customers.ts').some(name=>/erp-/.test(name))&&!importsOf('lib/kpis-server.ts').some(name=>/erp-customer|erp-sales'$/.test(name)),'the KPI reads never load the ERP upload parser');

// ---- «التاريخ»
const date=X.erpCustomerDate;
eq(date('2026/11/03'),'2026-11-03','year first, slashes (the owner\'s file)');
eq(date('2026-11-03'),'2026-11-03','year first, dashes');
eq(date('2026/1/5'),'2026-01-05','one-digit month and day');
eq(date('03/11/2026'),'2026-11-03','day first (the ERP\'s 03/11/2026 is 3 November)');
eq(date('3-11-2026'),'2026-11-03','day first, dashes');
eq(date('٢٠٢٦/١١/٠٣'),'2026-11-03','Arabic digits');
eq(date('۰۳/۱۱/۲۰۲۶'),'2026-11-03','Persian digits');
eq(date('2026/11/03 14:25:00'),'2026-11-03','with a time');
eq(date('2026/11/03 02:25 م'),'2026-11-03','with an Arabic afternoon mark');
eq(date('03/11/2026 9:05 PM'),'2026-11-03','day first with a 12-hour time');
eq(date(' ‏2026/11/03‎ '),'2026-11-03','direction marks and spaces');
eq(date('46329'),'2026-11-03','an Excel serial day');
eq(date('46329.75'),'2026-11-03','an Excel serial with a time of day');
eq(date(46329),'2026-11-03','an Excel serial as a number');
eq(date('٤٦٣٢٩'),'2026-11-03','an Excel serial in Arabic digits');
eq([date(''),date('   '),date(null),date(undefined)],['','','',''],'an empty cell is no date, not an error');
eq([date('2026/02/30'),date('31/04/2026'),date('2026/13/01'),date('1985/01/01'),date('nov 3'),date('12345678'),date('2026/11'),date('99')],[null,null,null,null,null,null,null,null],'what is no day is refused');

// ---- reading a sheet
const header=['رقم العميل','رقم الهوية','الاسم بالعربي','الاسم بالانجليزي','رقم الجوال','رقم الهاتف','البريد الالكتروني','العنوان','التاريخ'];
const sheet=(rows,head=header,name='Customer')=>({name,rows:[{rowNumber:1,cells:['Customer']},{rowNumber:2,cells:head},...rows.map((cells,index)=>({rowNumber:index+3,cells}))]});
let extras=X.erpCustomerExtras([sheet([['1','','أ','','','','','','2026/11/03'],['2','','ب','','','','','',''],['3','','ج','','','','','','2026/02/30'],['4','','د','','','','','','46300']])],'Customer');
eq([extras.dateColumn,extras.repColumn,extras.dates,extras.invalidDates,extras.reps],[true,false,2,1,0],'the owner\'s layout: dates, one unreadable, no representative column');
eq(Object.fromEntries(extras.rows),{3:{erpCreatedAt:'2026-11-03'},5:{invalidDate:true},6:{erpCreatedAt:'2026-10-05'}},'by the row number; an empty date is nothing');
const repHeader=[...header,'اسم المندوب','رقم الموظف'];
extras=X.erpCustomerExtras([sheet([['1','','أ','','','','','','2026/11/03','أحمد علي','E7'],['2','','ب','','','','','','','  ',''],['3','','ج','','','','','','','مبيعات مكتب','']],repHeader)],'Customer');
eq([extras.repColumn,extras.reps],[true,2],'a representative column');
eq(Object.fromEntries(extras.rows),{3:{erpCreatedAt:'2026-11-03',erpRep:{employeeId:'E7',name:'أحمد علي'}},5:{erpRep:{name:'مبيعات مكتب'}}},'the name and the employee number, nothing for blank cells');
extras=X.erpCustomerExtras([sheet([['1','','أ','','','','','','','سالم']],[...header.slice(0,8),'تاريخ التسجيل','المندوب'])],'Customer');
eq([extras.dateColumn,extras.repColumn,Object.fromEntries(extras.rows)],[false,true,{3:{erpRep:{name:'سالم'}}}],'«المندوب» alone; another date header is no «التاريخ» column');
extras=X.erpCustomerExtras([sheet([['1','','أ','','','','','','','K-9']],[...header,'كود المندوب'])],'Customer');
eq(Object.fromEntries(extras.rows),{3:{erpRep:{employeeId:'K-9'}}},'«كود المندوب» is the employee number');
eq(X.erpCustomerExtras([sheet([['1','','أ','','','','','','2026/11/03']])],'Other').rows.size,0,'another sheet reads nothing');
eq(X.erpCustomerExtras([{name:'Customer',rows:[{rowNumber:1,cells:['التاريخ','الاسم']}]}],'Customer').dateColumn,false,'no header with the customer number: nothing');
extras=X.erpCustomerExtras([sheet([['رقم العميل','','','','','','','','التاريخ'],['5','','هـ','','','','','','2026/11/04']])],'Customer');
eq(Object.fromEntries(extras.rows),{4:{erpCreatedAt:'2026-11-04'}},'a repeated header row is skipped');

// ---- what a row changes on a customer
const change=X.erpExtraChange;
eq(change({},{erpCreatedAt:'2026-11-03'}),{set:{erpCreatedAt:'2026-11-03'},from:{}},'a first date');
eq(change({erpCreatedAt:'2026-10-01'},{erpCreatedAt:'2026-11-03'}),{set:{erpCreatedAt:'2026-11-03'},from:{erpCreatedAt:'2026-10-01'}},'a changed date, with the old one');
eq(change({erpCreatedAt:'2026-11-03'},{erpCreatedAt:'2026-11-03'}),null,'the same date changes nothing');
eq(change({erpCreatedAt:'2026-11-03'},{invalidDate:true}),null,'an unreadable cell keeps the stored date');
eq(change({erpCreatedAt:'2026-11-03'},undefined),null,'an empty cell (no extra) keeps the stored date');
eq(change({erpRep:{employeeId:'E7',name:'أحمد'}},{erpRep:{name:'أحمد'}}),null,'the same name keeps the stored employee number');
eq(change({erpRep:{employeeId:'E7',name:'أحمد'}},{erpRep:{name:'سالم'}}),{set:{erpRep:{name:'سالم'}},from:{erpRep:{employeeId:'E7',name:'أحمد'}}},'a new name drops the old employee number');
eq(change({erpRep:{employeeId:'E7',name:'أحمد'}},{erpRep:{employeeId:'E8'}}),{set:{erpRep:{employeeId:'E8'}},from:{erpRep:{employeeId:'E7',name:'أحمد'}}},'a new number drops the old name');
eq(change({erpRep:{name:'أحمد'}},{erpRep:{employeeId:'E7',name:'أحمد'}}),{set:{erpRep:{employeeId:'E7',name:'أحمد'}},from:{erpRep:{name:'أحمد'}}},'a number added beside the same name');
eq(X.erpExtraData({erpCreatedAt:'2026-11-03',invalidDate:false}),{erpCreatedAt:'2026-11-03'},'a new customer gets the date');
eq(X.erpExtraData({invalidDate:true}),{},'and nothing for an unreadable one');

// ---- the updates of an import
const customer=(id,data={},extra={})=>({id,kind:'customer',parentId:null,assignedTo:'rep',branch:'HQ',data:{name:id,...data},createdAt:'2025-01-01T00:00:00Z',updatedAt:'',version:3,...extra});
const book=new Map([['a',customer('a')],['b',customer('b',{erpCreatedAt:'2026-11-03'})],['c',customer('c')],['locked',customer('locked')]]);
extras={rows:new Map([[3,{erpCreatedAt:'2026-11-03'}],[4,{erpCreatedAt:'2026-11-03'}],[5,{erpCreatedAt:'2026-11-05'}],[6,{erpCreatedAt:'2026-11-06'}],[7,{erpCreatedAt:'2026-11-07'}],[8,{erpCreatedAt:'2026-11-08'}],[9,{erpCreatedAt:'2026-11-09'}]]),dateColumn:true,repColumn:false,dates:7,invalidDates:0,reps:0};
const outcomes=[{row:3,customerId:'a',add:false,conflict:false},{row:4,customerId:'b',add:false,conflict:false},{row:5,customerId:'',add:true,conflict:false},{row:6,customerId:'c',add:false,conflict:true},{row:7,customerId:'locked',add:false,conflict:false},{row:8,customerId:'a',add:false,conflict:false},{row:9,customerId:'',add:false,conflict:false}];
eq(X.erpExtraUpdates(outcomes,extras,book,row=>row.id!=='locked'),[{row:3,customerId:'a',version:3,set:{erpCreatedAt:'2026-11-03'},from:{}}],'only a customer a row ends on, not in conflict, that the member may change, whose date differs; each once');

// ---- the representative as a member
const resolver=N.erpRepResolver([{employeeId:' E7 ',repId:'rep1'}],[{id:'rep1',name:'أحمد علي',role:'rep'},{id:'rep2',name:'سالم  محمد',role:'rep'},{id:'twin1',name:'خالد',role:'rep'},{id:'twin2',name:'خالد',role:'rep'},{id:'boss',name:'مدير',role:'manager'}]);
const who=value=>N.resolveErpRep(value,resolver);
eq(who({employeeId:'E7',name:'أي اسم'}),{memberId:'rep1'},'by the saved ERP employee mapping first');
eq(who({employeeId:'E9',name:'سالم محمد'}),{memberId:'rep2'},'else by one representative\'s full name (spaces normalized)');
eq(who({name:'خالد'}),null,'a name two representatives carry names nobody');
eq(who({name:'مدير'}),null,'only representatives are matched by name');
eq(who({name:'سالم'}),null,'never a partial name');
eq(who({name:'مبيعات مكتب',employeeId:'E7'}),'office','«مبيعات مكتب» is office sales, whatever the number');
eq(who({name:' مبيعات  المكتب '}),'office','«مبيعات المكتب» too');
eq([who(undefined),who({}),who('x'),who({name:5})],[null,null,null,null],'nothing stored');
for(const name of ['مبيعات مكتب','مبيعات المكتب',' مبيعات\u200f مكتب ','مبيعات','مكتب المبيعات','مندوب'])eq(N.isOfficeRepName(name),S.isOfficeEmployee(name),'the office names agree with the ERP sales import: '+name);

// ---- the KPI
const attribute=value=>N.resolveErpRep(value,resolver);
const period={first:'2026-10-01',cutoff:'2026-10-31'};
const credited=(rows,attr=attribute)=>{const result=N.newCustomerCredits(rows,period,attr);return {credits:Object.fromEntries(result.credits),unknown:result.unknown,erp:result.erp,office:result.office};};
const old='2025-03-01T08:00:00Z',inOctober='2026-10-15T08:00:00Z';
eq(credited([customer('x',{erpCreatedAt:'2026-10-03'},{assignedTo:'rep1'})]).credits,{x:'rep1'},'an ERP date in the month: the current responsible (no representative column)');
eq(credited([customer('x',{erpCreatedAt:'2026-10-03',assignedTo:'rep1'},{assignedTo:''})]).credits,{x:'rep1'},'the responsible kept in the data when the column is empty');
eq(credited([customer('x',{erpCreatedAt:'2026-10-03',erpRep:{name:'سالم محمد'}},{assignedTo:'rep1'})]).credits,{x:'rep2'},'the file\'s representative, mapped, wins over the responsible');
eq(credited([customer('x',{erpCreatedAt:'2026-10-03',erpRep:{name:'مجهول'}},{assignedTo:'rep1'})]).credits,{x:'rep1'},'a representative the CRM cannot match: the responsible');
eq(credited([customer('x',{erpCreatedAt:'2026-10-03',erpRep:{name:'مبيعات مكتب'}},{assignedTo:'rep1'})]),{credits:{},unknown:false,erp:0,office:1},'office sales never count');
eq(credited([customer('x',{erpCreatedAt:'2026-09-30'},{assignedTo:'rep1'}),customer('y',{erpCreatedAt:'2026-11-01'},{assignedTo:'rep1'})]).credits,{},'another month does not count');
eq(credited([customer('x',{erpCreatedAt:'2026-10-03',_createdBy:'rep2'},{createdAt:inOctober,assignedTo:'rep1'})]).credits,{x:'rep2'},'added by hand and created in the ERP in the month: once, to whom added it');
eq(credited([customer('x',{_createdBy:'rep2'},{createdAt:inOctober})]).credits,{x:'rep2'},'added by hand in the month, as before');
eq(credited([customer('x',{_createdBy:'rep2'},{createdAt:'2026-09-30T21:30:00Z'})]).credits,{x:'rep2'},'a Riyadh day: 21:30 on 30 September UTC is 00:30 on 1 October in Riyadh');
eq(credited([customer('x',{_createdBy:'rep2'},{createdAt:'2026-10-31T21:30:00Z'})]).credits,{},'and 21:30 on 31 October UTC is November in Riyadh');
eq(credited([customer('x',{_createdBy:'rep2',sourceFile:'f.xlsx'},{createdAt:inOctober})]).credits,{},'a file import is not added by hand');
const imported='crm-owner-erp-123e4567-e89b-42d3-a456-426614174000-12';
ok(N.erpImportedCustomer({id:imported})&&!N.erpImportedCustomer({id:'crm-rep-erp-1'}),'the id the ERP customers import gives');
eq(credited([customer(imported,{_createdBy:'owner'},{createdAt:inOctober,assignedTo:'owner'})]).credits,{},'an ERP-imported customer is not the importer\'s hand-made one');
eq(credited([customer(imported,{_createdBy:'owner',erpCreatedAt:'2026-10-20'},{createdAt:inOctober,assignedTo:'rep1'})]).credits,{[imported]:'rep1'},'it counts by its ERP date, for its responsible');
eq(credited([customer('legacy',{},{createdAt:inOctober})]).unknown,true,'made in the month with no maker and no ERP date: unknown, as before');
eq(credited([customer('legacy',{erpCreatedAt:'2026-10-02'},{createdAt:inOctober,assignedTo:'rep1'})]),{credits:{legacy:'rep1'},unknown:false,erp:1,office:0},'with an ERP date it is known, and counts by that date');
eq(credited([customer('legacy',{erpCreatedAt:'2025-01-02'},{createdAt:inOctober,assignedTo:'rep1'})]),{credits:{},unknown:false,erp:0,office:0},'an ERP date in another month: known, not new this month');
eq(credited([customer('x',{erpCreatedAt:'2026-10-03'},{assignedTo:'rep1',createdAt:old})],undefined).credits,{x:'rep1'},'without the server\'s mapping: the responsible');
eq(credited([customer('x',{erpCreatedAt:'bad'},{assignedTo:'rep1'})]).credits,{},'a stored value that is no day counts nothing');
eq(N.newCustomersOf(new Map([['a','rep1'],['b','rep2'],['c','rep1']]),new Set(['rep1','rep2'])),3,'a team counts each customer once');

// calculateKpis: the metric itself.
const performance=(ids=['rep1'])=>({member:{id:ids[0],role:'rep'},sourceMemberIds:ids,salesSourceMemberIds:ids,teamRollup:false,activityTeamRollup:false,activityTargets:{newCustomers:4,recoveredCustomers:1,visits:10},attainment:{rows:[],score:null,status:'weights_missing',weightsMonth:null,applicableWeight:null}});
const month='2026-10';
const records=[
 customer('erp-a',{erpCreatedAt:'2026-10-03'},{assignedTo:'rep1'}),
 customer('erp-b',{erpCreatedAt:'2026-10-04',erpRep:{employeeId:'E7'}},{assignedTo:'rep2'}),
 customer('erp-c',{erpCreatedAt:'2026-10-05',erpRep:{name:'مبيعات مكتب'}},{assignedTo:'rep1'}),
 customer('erp-d',{erpCreatedAt:'2026-09-05'},{assignedTo:'rep1'}),
 customer('both',{erpCreatedAt:'2026-10-06',_createdBy:'rep1'},{assignedTo:'rep1',createdAt:inOctober}),
 customer('other',{erpCreatedAt:'2026-10-06'},{assignedTo:'rep2'}),
];
const metricOf=(rows,ids,attr=attribute)=>K.calculateKpis(performance(ids),month,rows,[],null,K.prepareKpiRecords(rows,month,attr)).metrics.find(m=>m.id==='new_customers');
let m=metricOf(records,['rep1']);
eq([m.numerator,m.denominator,m.score,m.reason],[3,4,75,K.NEW_CUSTOMERS_REASON],'rep1: erp-a (responsible), erp-b (mapped E7), both (once); not office, not September');
m=metricOf(records,['rep2']);eq([m.numerator,m.score],[1,25],'rep2: only «other» (erp-b goes to the mapped representative)');
m=metricOf(records,['rep1','rep2']);eq(m.numerator,4,'a team counts each customer once');
m=metricOf([...records,customer('legacy',{},{createdAt:inOctober,assignedTo:'rep1'})],['rep1']);eq([m.numerator,m.score,m.status],[null,null,'missing'],'a customer with no maker and no ERP date keeps the metric unknown');
m=metricOf([...records,customer('legacy',{erpCreatedAt:'2026-10-09'},{createdAt:inOctober,assignedTo:'rep1'})],['rep1']);eq([m.numerator,m.status],[4,'scored'],'one with an ERP date does not');
ok(K.NEW_CUSTOMERS_REASON.includes('ERP')&&K.NEW_CUSTOMERS_REASON.includes('المسؤول الحالي')&&K.NEW_CUSTOMERS_REASON.includes('مبيعات مكتب'),'«طريقة الحساب» names the ERP date, the current responsible and office sales');
const english=JSON.parse(fs.readFileSync(path.join(root,'lib/locales/en.json'),'utf8'));
ok(typeof english[K.NEW_CUSTOMERS_REASON]==='string'&&!/[؀-ۿ]/.test(english[K.NEW_CUSTOMERS_REASON]),'it has an English text without Arabic');

console.log(JSON.stringify({ok:true,checks,syntheticFixtures:true,productionDataUsed:false,scope:'ERP customer date and representative: parsing, sheet reading, changes, updates, member mapping, office exclusion, the new-customers KPI'}));
