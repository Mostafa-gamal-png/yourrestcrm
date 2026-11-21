// «الطاقة الإنتاجية والاحتياج» of a customer and «موعد احتياج القوالب المتوقع» of a visit (the owner, 2026-11-21: «كنت محتاج خانه فيها - عدد
// المكائن (تتحسب) - نوع المكائن (تتجمع) - عدد القوالب المستخدمه … - الطاقه الإنتاجية … - حجم الطلب السنوي … الحجات دى تتشاف من بره فى كرت العميل -
// موعد احتياج القوالب المتوقع دى فى تفاصيل الزيارة / البيانات دى كلها اختيارى»), without a build, on the real modules
// (lib/customer-capacity.ts, lib/crm.ts, lib/customer-edit-requests.ts, lib/permissions.ts, app/customer-capacity.tsx): the computed count
// (the machines registered one by one, each its «العدد», none counting one; never added to the sheet's; the sheet's with «حسب الشيت» when none
// is registered, and not at all when the sheet holds no number), the types grouped (stationary and mobile by their words, an unknown type by
// its manufacturer, spelled the same whatever its case and spaces, «غير محدد» last, the largest first), the three entered fields read and
// refused (Arabic digits, thousands, marks of direction; 0 to 10,000; 100 characters), a save that does not carry them keeping what is stored
// (an old page or a device queue never erases them), the direct save of a representative's or a marketing officer's change of these three alone
// on their own customer and nothing else (a colleague's customer, another field, another role wait for approval), the request carrying them,
// the visit's day (optional, the day of recording or later when set or changed, a stored day kept by an edit that does not carry it or that
// leaves it), the six columns of the customers' export and the one of the visits', the words in Arabic and English, and the block and the
// form's section drawn on the server. No network, no real data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'customer-capacity-')),seen=new Set();
process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
function compile(relative){
 if(seen.has(relative))return;seen.add(relative);
 const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));
 fs.mkdirSync(path.dirname(dest),{recursive:true});
 let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
  if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
  let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
  if(/\.json$/.test(source)){const target=path.join(out,source);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,source),target);return 'from '+JSON.stringify(target)+' with {type:"json"}';}
  if(/\.(mjs|js)$/.test(source))return 'from '+JSON.stringify(pathToFileURL(path.join(root,source)).href);
  if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';
  compile(source);return 'from '+JSON.stringify(path.join(out,source.replace(/\.tsx?$/,'.mjs')));
 });
 code=code.replace(/^import\s+(['"])[^'"]+\.css\1;?$/mg,'');
 fs.writeFileSync(dest,code);
}
const load=async relative=>{compile(relative);return import(pathToFileURL(path.join(out,relative.replace(/\.tsx?$/,'.mjs'))));};
const C=await load('lib/customer-capacity.ts');
const {schemas}=await load('lib/crm.ts');
const edits=await load('lib/customer-edit-requests.ts');
const permissions=await load('lib/permissions.ts');
const en=JSON.parse(fs.readFileSync(path.join(root,'lib/locales/en.json'),'utf8'));
const ARABIC=/[؀-ۿ]/;
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;},ok=(value,message)=>{assert.ok(value,message);checks++;};

// ---- «عدد القوالب المستخدمة»: a whole number 0 to 10,000.
const molds=[[5,5],[0,0],[10000,10000],['12',12],['١٢',12],['۱۲',12],[' ١٢ ',12],['‏١٢‎',12],['10,000',10000],['١٠٬٠٠٠',10000],['007',7],['',''],['   ',''],[null,''],[undefined,'']];
for(const [input,expected] of molds)eq(C.readMoldsInUse(input),expected,'molds read: '+JSON.stringify(input));
for(const input of [-1,10001,'10001','1.5',1.5,'١٫٥','abc','1,5','1,00','12 قالب',true,{},[],NaN,Infinity,'1e3','٠x10','100000000'])eq(C.readMoldsInUse(input),null,'molds refused: '+JSON.stringify(input));
// ---- «الطاقة الإنتاجية» and «حجم الطلب السنوي»: one short line.
eq(C.readCapacityText('  5000   بلكة\nيوميًا '),'5000 بلكة يوميًا','one line, runs of spaces made one, trimmed');
eq([C.readCapacityText('a'.repeat(100)).length,C.readCapacityText('ب'.repeat(100)).length,C.readCapacityText('a'.repeat(101)),C.readCapacityText('ب'.repeat(101))],[100,100,null,null],'100 characters, not 101');
eq([C.readCapacityText(''),C.readCapacityText(null),C.readCapacityText(5000),C.readCapacityText({}),C.readCapacityText(['x']),C.readCapacityText(NaN)],['','','5000',null,null,null],'empty, null, a number as its text, anything else refused');

// ---- The customer's schema (lib/crm.ts): absent stays absent, null empty, refused with the field's own words.
const base={name:'مصنع',branch:'الرئيسي',assignedTo:'rep1'};
const parsed=schemas.customer.parse({...base,moldsInUse:'٣٠',productionCapacity:' 5000 بلكة يوميًا ',annualDemand:'40 قالبًا'});
eq([parsed.moldsInUse,parsed.productionCapacity,parsed.annualDemand],[30,'5000 بلكة يوميًا','40 قالبًا'],'read by the schema');
const absent=schemas.customer.parse(base);
eq(['moldsInUse','productionCapacity','annualDemand'].map(key=>key in absent),[false,false,false],'absent from the save: absent from the data (the route keeps what is stored)');
eq(Object.values((({moldsInUse,productionCapacity,annualDemand})=>({moldsInUse,productionCapacity,annualDemand}))(schemas.customer.parse({...base,moldsInUse:null,productionCapacity:null,annualDemand:''}))),['','',''],'null and empty: empty');
for(const [field,value,message] of [['moldsInUse','10001',C.MOLDS_REFUSED],['moldsInUse','x',C.MOLDS_REFUSED],['productionCapacity','x'.repeat(101),C.PRODUCTION_CAPACITY_REFUSED],['annualDemand',{},C.ANNUAL_DEMAND_REFUSED]]){
 const result=schemas.customer.safeParse({...base,[field]:value});
 eq([result.success,result.success?'':result.error.issues.map(issue=>issue.message).join(' • ')],[false,message],'refused with its words: '+field);
}
eq(schemas.customer.omit({assignedTo:true,branch:true}).parse({name:'x',moldsInUse:'2'}).moldsInUse,2,'and through the schema the route uses for a correction');

// ---- A save that does not carry them keeps what is stored; an empty one removes it; a new customer has what it was given.
const stored={name:'x',moldsInUse:12,productionCapacity:'قديم',annualDemand:'سنوي'};
let data={name:'x'};C.keepAbsentCapacity(data,{name:'x'},stored);
eq(data,{name:'x',moldsInUse:12,productionCapacity:'قديم',annualDemand:'سنوي'},'a page or a device queue of the release before: the three kept');
data={name:'x',moldsInUse:''};C.keepAbsentCapacity(data,{name:'x',moldsInUse:'',productionCapacity:null},stored);
eq(data,{name:'x',annualDemand:'سنوي'},'emptied: removed; the one not sent: kept');
data={name:'x',moldsInUse:7,productionCapacity:'جديد'};C.keepAbsentCapacity(data,{moldsInUse:'٧',productionCapacity:'جديد'},undefined);
eq(data,{name:'x',moldsInUse:7,productionCapacity:'جديد'},'a new customer: what it was given');
data={name:'x'};C.keepAbsentCapacity(data,{},{name:'x',moldsInUse:'not a number'});
eq(data,{name:'x',moldsInUse:'not a number'},'a stored value is carried exactly as stored, never judged by a save that does not touch it');
data={name:'x'};C.keepAbsentCapacity(data,{},{name:'x'});
eq(data,{name:'x'},'nothing stored, nothing sent: nothing');

// ---- The count and the types.
const m=(id,parent,data)=>({id,kind:'factory',parentId:parent,data});
const records=[
 m('a','c1',{recordType:'machine',machineType:'stationary',quantity:2,machineBrand:'Besser'}),
 m('b','c1',{recordType:'machine',machineType:'mobile',machineBrand:'Besser'}),
 m('c','c1',{recordType:'machine',machineType:'unknown',machineBrand:'  QGM '}),
 m('d','c1',{recordType:'machine',machineType:'unknown',machineBrand:'qgm',quantity:3}),
 m('e','c1',{recordType:'machine',machineType:'unknown',machineBrand:''}),
 m('f','c1',{machineBrand:'Columbia'}),
 m('g','c1',{recordType:'group',quantity:9,sourceMachineTypes:'خط ثابت'}),
 m('h','c2',{recordType:'machine',machineType:'stationary'}),
 m('z','c1',{recordType:'machine',machineType:'stationary',quantity:0}),
 {id:'v',kind:'activity',parentId:'c1',data:{}},
];
const groups=C.machineTypeGroups('c1',records);
eq(groups.map(group=>[group.kind,group.label,group.count]),[['brand','QGM',4],['type','ثابتة',2],['type','متحركة',1],['brand','Columbia',1],['unknown','غير محدد',1]],
 'grouped: by type, an unknown type by its manufacturer (QGM and «  qgm » one group, its first spelling), «غير محدد» last; each its «العدد» (none counts one; 0 adds nothing), the largest first, a type before a manufacturer of the same count; the sheet group and another customer\'s machine left out');
eq(C.machineTypesText(groups),'QGM ×4 · ثابتة ×2 · متحركة ×1 · Columbia ×1 · غير محدد ×1','one line');
eq(C.machineTypesText(groups,text=>en[text]||text),'QGM ×4 · Stationary ×2 · Mobile ×1 · Columbia ×1 · Unspecified ×1','in English: the type words translated, the manufacturers as typed');
let capacity=C.customerCapacity('c1',records,{machineCount:20,machineTypes:'خط ثابت',moldsInUse:30,productionCapacity:'5000 بلكة يوميًا',annualDemand:'40 قالبًا'});
eq([capacity.machines,capacity.types.fromSheet,capacity.registered,capacity.moldsInUse,capacity.productionCapacity,capacity.annualDemand],[{count:9,fromSheet:false},false,true,30,'5000 بلكة يوميًا','40 قالبًا'],
 'registered machines: 2+1+1+3+1+1 = 9 (never the sheet\'s 9 or 20 added), and the three entered fields');
eq(C.capacityItems(capacity),['machineCount','machineTypes','moldsInUse','productionCapacity','annualDemand'],'five items, in the card\'s order');
// The sheet: its group (as imported) or the customer's own count, with «حسب الشيت».
capacity=C.customerCapacity('c3',[m('s','c3',{recordType:'group',quantity:5,sourceMachineTypes:'Besser، خط ثابت'})],{machineCount:5,machineTypes:'Besser، خط ثابت'});
eq([capacity.machines,capacity.types,capacity.registered],[{count:5,fromSheet:true},{fromSheet:true,text:'Besser، خط ثابت'},false],'no machine registered: the sheet\'s count and types, marked');
eq(C.capacityItems(capacity,{sheetBeside:true}),[],'where the sheet\'s own count and types are shown beside, they are not said twice');
capacity=C.customerCapacity('c4',[],{machineCount:3});
eq([capacity.machines,capacity.types],[{count:3,fromSheet:true},null],'the customer\'s own sheet count alone');
eq(C.customerCapacity('c4b',[],{machineCount:0}).machines,{count:0,fromSheet:true},'a sheet that says 0 says 0');
capacity=C.customerCapacity('c5',[m('s5','c5',{recordType:'group',quantity:null,sourceMachineTypes:'Besser'})],{machineTypes:'Besser'});
eq([capacity.machines,capacity.types],[null,{fromSheet:true,text:'Besser'}],'a sheet group of no number: no count (not «0»), its types');
capacity=C.customerCapacity('c6',[m('s6','c6',{recordType:'group',sourceMachineTypes:'خط ثابت'})],{});
eq(capacity.types,{fromSheet:true,text:'خط ثابت'},'the types of the group when the customer\'s own field is empty');
capacity=C.customerCapacity('c7',[],{});
eq([capacity.machines,capacity.types,capacity.moldsInUse,capacity.productionCapacity,capacity.annualDemand,C.capacityItems(capacity)],[null,null,null,'','',[]],'nothing: no item at all');
eq(C.capacityItems(C.customerCapacity('c8',[],{moldsInUse:0})),['moldsInUse'],'0 molds is a value, shown');
eq(C.capacityItems(C.customerCapacity('c1',records,{annualDemand:'x'}),{only:['machineCount','machineTypes']}),['machineCount','machineTypes'],'only some items (the form shows the computed two)');
eq(C.customerCapacity('c9',[m('k','c9',{recordType:'machine',machineType:'stationary',quantity:0})],{machineCount:4}).machines,{count:0,fromSheet:false},'a registered machine of «العدد» 0: the registered count, never the sheet\'s (the rule of lib/customer-classification.ts)');

// ---- Who saves directly: a representative or a marketing officer, these three alone, their own customer.
const rep={id:'rep1',role:'rep'},mkt={id:'mkt',role:'marketing'};
const own={assignedTo:'rep1'},other={assignedTo:'rep2'};
eq([
 C.capacityEditIsDirect(rep,own,['moldsInUse']),
 C.capacityEditIsDirect(rep,own,['moldsInUse','productionCapacity','annualDemand']),
 C.capacityEditIsDirect(rep,other,['moldsInUse']),
 C.capacityEditIsDirect(rep,own,['moldsInUse','phone']),
 C.capacityEditIsDirect(rep,own,['notes']),
 C.capacityEditIsDirect(rep,own,[]),
 C.capacityEditIsDirect(mkt,{assignedTo:'mkt'},['annualDemand']),
 C.capacityEditIsDirect(mkt,own,['annualDemand']),
 C.capacityEditIsDirect({id:'sup',role:'supervisor'},{assignedTo:'sup'},['moldsInUse']),
 C.capacityEditIsDirect({id:'mgr',role:'manager'},{assignedTo:'mgr'},['moldsInUse']),
 C.capacityEditIsDirect({id:'cs',role:'customer_service'},{assignedTo:'cs'},['moldsInUse']),
 C.capacityEditIsDirect({id:'',role:'rep'},{assignedTo:''},['moldsInUse']),
],[true,true,false,false,false,false,true,false,false,false,false,false],'direct: the field roles, the three alone, their own customer; everything else waits as before');
eq(C.withCapacityOnly({name:'x',phone:'1',moldsInUse:3,annualDemand:'old'},{name:'changed',phone:'2',moldsInUse:4,productionCapacity:'new'}),{name:'x',phone:'1',moldsInUse:4,productionCapacity:'new'},
 'what a direct save writes: the stored customer with the three of the save over it (one the save left out removed), nothing else of the save');

// ---- The request (lib/customer-edit-requests.ts): the three travel in it, with their words.
for(const field of C.CAPACITY_FIELDS){ok(edits.CUSTOMER_EDIT_FIELDS.includes(field),field+' travels in a request');eq(edits.CUSTOMER_EDIT_FIELD_TEXT[field],C.CAPACITY_TEXT[field],field+' named as on the card');}
const proposal=edits.customerEditProposal({name:'x',moldsInUse:12,annualDemand:'قديم'},{name:'x',moldsInUse:13,productionCapacity:'جديد',annualDemand:'قديم'});
eq([proposal.fields,proposal.base,proposal.values],[['moldsInUse','productionCapacity'],{moldsInUse:'12',productionCapacity:''},{moldsInUse:13,productionCapacity:'جديد'}],'what changed, and nothing else');
eq(edits.customerEditProposal({moldsInUse:12},{moldsInUse:12}).fields,[],'the same number: no change');
eq(edits.applyCustomerEdit({name:'x',moldsInUse:12,annualDemand:'قديم'},{fields:['moldsInUse','annualDemand'],values:{moldsInUse:13,annualDemand:null}}),{name:'x',moldsInUse:13},'applied at the approval: a value set, an emptied one removed');
eq(edits.CUSTOMER_EDIT_HISTORY[edits.CAPACITY_EDIT],'تحديث الطاقة الإنتاجية والاحتياج','the history\'s words for a direct capacity update');
ok(en[edits.CUSTOMER_EDIT_HISTORY[edits.CAPACITY_EDIT]]&&!ARABIC.test(en[edits.CUSTOMER_EDIT_HISTORY[edits.CAPACITY_EDIT]]),'and in English');
eq(edits.CUSTOMER_EDIT_FIELDS.some(field=>edits.CUSTOMER_EDIT_LOCKED.includes(field)),false,'no locked field is a request field');

// ---- The matrix explains it (restrict-only: «العملاء · تحرير» still decides; no new cell).
const editCell=permissions.permissionRow('customer').cells.edit;
ok(editCell.roleNote.rep.ar.includes('الطاقة الإنتاجية والاحتياج')&&editCell.roleNote.rep.ar.includes('مباشرةً'),'the representative\'s note says the three are saved directly');
ok(editCell.roleNote.marketing.ar.includes('الطاقة الإنتاجية والاحتياج')&&editCell.roleNote.marketing.ar.includes('عميل فرع آخر أو تغيير منطقة العميل طلبٌ ينتظر الموافقة'),'the marketing officer\'s note, its earlier words kept');
eq([ARABIC.test(editCell.roleNote.rep.en),ARABIC.test(editCell.roleNote.marketing.en.replace(/«[^»]*»/g,''))],[false,false],'both in English');
eq(Object.keys(permissions.permissionRow('customer').cells),['add','edit','delete','export','import'],'no new cell');

// ---- The visit's «موعد احتياج القوالب المتوقع».
const visit={visitWorkflow:'customer-v1',type:'visit',date:'2026-11-21',summary:'زيارة',responsibleId:'rep1'};
eq(schemas.activity.parse({...visit,moldNeedBy:'2027-03-01'}).moldNeedBy,'2027-03-01','a day');
eq('moldNeedBy' in schemas.activity.parse(visit),false,'absent: absent (the route keeps what is stored)');
eq(schemas.activity.parse({...visit,moldNeedBy:''}).moldNeedBy,'','empty');
for(const bad of ['2027-02-30','2027-3-1','next month','2027-03'])eq(schemas.activity.safeParse({...visit,moldNeedBy:bad}).success,false,'refused: '+bad);
const keep=(data,sent,storedVisit,earliest='2026-11-21')=>{const copy={...data};return [C.keepMoldNeed(copy,sent,storedVisit,earliest),copy];};
eq(keep({summary:'x'},{summary:'x'},{moldNeedBy:'2026-01-10'}),['',{summary:'x',moldNeedBy:'2026-01-10'}],'an edit from a page of the release before: the stored day kept, even past');
eq(keep({summary:'x',moldNeedBy:'2026-01-10'},{moldNeedBy:'2026-01-10'},{moldNeedBy:'2026-01-10'}),['',{summary:'x',moldNeedBy:'2026-01-10'}],'a stored past day sent back unchanged: never refused');
eq(keep({summary:'x',moldNeedBy:'2026-11-20'},{moldNeedBy:'2026-11-20'},{moldNeedBy:'2026-01-10'})[0],C.MOLD_NEED_PAST,'changed to a day before the day of recording: refused');
eq(keep({summary:'x',moldNeedBy:'2026-11-20'},{moldNeedBy:'2026-11-20'},undefined)[0],C.MOLD_NEED_PAST,'a new visit with a past day: refused');
eq(keep({summary:'x',moldNeedBy:'2026-11-21'},{moldNeedBy:'2026-11-21'},undefined),['',{summary:'x',moldNeedBy:'2026-11-21'}],'the day of recording: allowed');
eq(keep({summary:'x',moldNeedBy:'2026-11-20'},{moldNeedBy:'2026-11-20'},undefined,'2026-11-20')[0],'','a visit queued on the device is judged against the day it was recorded');
eq(keep({summary:'x',moldNeedBy:''},{moldNeedBy:''},{moldNeedBy:'2026-12-01'}),['',{summary:'x'}],'emptied: removed');
eq(keep({summary:'x'},{},{moldNeedBy:'nonsense'}),['',{summary:'x'}],'a stored value that is not a day reads as none');
eq(keep({summary:'x'},{},undefined),['',{summary:'x'}],'none');
eq([C.moldNeedDay({moldNeedBy:'2027-01-05'}),C.moldNeedDay({moldNeedBy:5}),C.moldNeedDay(null)],['2027-01-05','',''],'the stored day, read');

// ---- The routes carry the rules (the HTTP test tries them on the built release).
const crmRoute=fs.readFileSync(path.join(root,'app/api/crm/route.ts'),'utf8'),visitsRoute=fs.readFileSync(path.join(root,'app/api/visits/route.ts'),'utf8'),legacy=fs.readFileSync(path.join(root,'lib/followups-server.ts'),'utf8');
ok(/keepAbsentClassification\(data,inputData,old\?\.data\);\s*\/\/[^\n]*\n[^\n]*\n\s*keepAbsentCapacity\(data,inputData,old\?\.data\);/.test(crmRoute),'POST /api/crm keeps the three a save does not carry');
ok(crmRoute.includes('capacityEditIsDirect(c.me,old,customerEditProposal(old.data,data).fields)')&&crmRoute.includes("!capacityDirect&&(proposesCustomerEdit(c.me.role)||marketingWaits))return await proposeCustomerEdit("),'the direct capacity save decided before a request is made');
ok(crmRoute.includes("kind='customer' AND assigned_to=?)\"")&&crmRoute.includes('withCapacityOnly(stored,data)')&&crmRoute.includes('for(const key of CUSTOMER_DECORATIONS)delete stored[key]'),'written as the stored customer with the three, gated on the customer being still theirs');
ok(visitsRoute.includes('keepMoldNeed(data,isRecord(body.data)?body.data:undefined,old?.data,offline?visitDate:today())'),'POST /api/visits keeps the day and judges a new one against the day of recording');
ok(/'customerNeeds','moldNeedBy','requestId'/.test(legacy),'the older entry point (POST /api/crm activity) refuses the field, as every field of the visits page');

// ---- The exports.
const capacities=new Map([['c1',C.customerCapacity('c1',records,{moldsInUse:30,productionCapacity:'5000 بلكة',annualDemand:''})],['c3',C.customerCapacity('c3',[],{machineCount:5,machineTypes:'Besser'})],['c7',C.customerCapacity('c7',[],{})]]);
const cell=(language,id)=>C.capacityExportColumns(row=>capacities.get(row.id),(ar,enText)=>language==='en'?enText:ar,text=>language==='en'?en[text]||text:text).map(([header,value,kind])=>[header,value({id}),kind]);
eq(cell('ar','c1'),[['عدد الماكينات',9,'number'],['مصدر عدد الماكينات','الماكينات المسجلة',undefined],['أنواع الماكينات','QGM ×4 · ثابتة ×2 · متحركة ×1 · Columbia ×1 · غير محدد ×1',undefined],['عدد القوالب المستخدمة',30,'number'],['الطاقة الإنتاجية','5000 بلكة',undefined],['حجم الطلب السنوي','',undefined]],'the six columns of a customer with registered machines');
eq(cell('en','c3').map(([header,value])=>[header,value]),[['Machines',5],['Machine count source','per the sheet'],['Machine types','Besser (per the sheet)'],['Molds in use',''],['Production capacity',''],['Annual demand','']],'in English, the sheet\'s');
eq(cell('ar','c7').map(([,value])=>value),['','','','','',''],'nothing: empty cells');
const app=fs.readFileSync(path.join(root,'app/crm-app.tsx'),'utf8');
ok(app.includes("...capacityExportColumns<Row>(capacityOf, say, t)")&&app.includes("['موعد احتياج القوالب المتوقع', r => moldNeedDay(r.data), 'day']"),'the customers\' export has the six, the visits\' the day (a date cell)');

// ---- The words: Arabic and English, no Arabic left in English.
for(const [key,[ar,enText]] of Object.entries(C.CAPACITY_TEXT)){ok(ARABIC.test(ar)&&!ARABIC.test(enText),'the words of '+key);}
eq([ARABIC.test(C.CAPACITY_SECTION_TEXT[1]),ARABIC.test(C.FROM_SHEET_TEXT[1]),ARABIC.test(C.MOLD_NEED_TEXT[1])],[false,false,false],'the section, «حسب الشيت» and the visit\'s day in English');
for(const message of [C.MOLDS_REFUSED,C.PRODUCTION_CAPACITY_REFUSED,C.ANNUAL_DEMAND_REFUSED,C.MOLD_NEED_PAST,C.MOLD_NEED_TEXT[0]])ok(en[message]&&!ARABIC.test(en[message]),'translated: '+message);

// ---- Drawn on the server (in Arabic; the English is tried in the browser test).
const component=await load('app/customer-capacity.tsx');
const React=await import('react'),{renderToStaticMarkup}=await import('react-dom/server');
const html=(name,props)=>renderToStaticMarkup(React.createElement(component[name],props));
const words=markup=>markup.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const full=html('CustomerCapacity',{customerId:'c1',data:{moldsInUse:30,productionCapacity:'5000 بلكة يوميًا',annualDemand:'40 قالبًا'},machines:records});
eq((full.match(/data-capacity-item="/g)||[]).length,5,'the card: five items');
ok(words(full).includes('عدد الماكينات 9')&&words(full).includes('أنواع الماكينات QGM ×4 · ثابتة ×2 · متحركة ×1 · Columbia ×1 · غير محدد ×1')&&words(full).includes('عدد القوالب المستخدمة 30')&&words(full).includes('الطاقة الإنتاجية 5000 بلكة يوميًا')&&words(full).includes('حجم الطلب السنوي 40 قالبًا'),'their words: '+words(full));
ok(full.includes('<bdi>QGM</bdi>'),'a manufacturer isolated in its own direction');
const sheetOnly=html('CustomerCapacity',{customerId:'c3',data:{machineCount:5,machineTypes:'Besser'},machines:[]});
ok(words(sheetOnly).includes('عدد الماكينات 5 · حسب الشيت')&&words(sheetOnly).includes('أنواع الماكينات Besser · حسب الشيت'),'the sheet\'s, marked: '+words(sheetOnly));
eq(html('CustomerCapacity',{customerId:'c3',data:{machineCount:5,machineTypes:'Besser'},machines:[],variant:'row',sheetBeside:true}),'','the desktop row beside the sheet\'s own column: nothing to add');
eq(html('CustomerCapacity',{customerId:'c7',data:{},machines:[]}),'','nothing: no block at all');
const sheet=html('CustomerCapacity',{customerId:'c1',data:{annualDemand:'x'},machines:records,variant:'sheet'});
ok(sheet.includes('<h3>الطاقة الإنتاجية والاحتياج</h3>')&&sheet.includes('data-capacity-summary'),'the sheet: its heading');
const form=html('CustomerCapacityFields',{customerId:'c1',data:{moldsInUse:30,productionCapacity:'',annualDemand:'سنوي'},machines:records,contextKey:'k',directNote:true,onChange:()=>{}});
eq([(form.match(/<input/g)||[]).length,form.includes('data-capacity-direct-note'),form.includes('value="30"'),form.includes('value="سنوي"'),form.includes('inputMode="numeric"')||form.includes('inputmode="numeric"'),(form.match(/maxLength="100"|maxlength="100"/g)||[]).length,words(form).includes('عدد الماكينات 9')],[3,true,true,true,true,2,true],'the form: three fields (a number keyboard; 100 characters for the two texts), the computed machines read only, and the note of the direct save');
eq(html('CustomerCapacityFields',{data:{},machines:[],contextKey:'k',onChange:()=>{}}).includes('data-capacity-direct-note'),false,'no note where the save waits or is direct anyway');
ok((form.match(/voice-button|has-voice-input|keyboard-input/g)||[]).length>=2,'the two texts with dictation, as the other free-text fields');

console.log(JSON.stringify({ok:true,checks}));
