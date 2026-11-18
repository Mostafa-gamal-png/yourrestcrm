// The classifications of a customer (the owner, 2026-11-18, with «مسؤول تسويق»; lib/customer-classification.ts), without a build:
// «تصنيف الفرصة» A to D with their help and «ملاحظات التصنيف», «حجم المصنع» suggested from the registered machines (0 to 6 machines; a
// stored value always wins; D «متوقف» never suggested), «اهتمام العميل»; the schema of a customer (unknown values refused with their
// message, trimmed, absent kept), what a save keeps and what it changes, the words in Arabic and English (no Arabic left in English),
// the filters of «العملاء», and the fields a supervisor's request may carry. Pure rules on the real modules; no network, no real data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'customer-classification-')),seen=new Set();
process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
function compile(relative){
 if(seen.has(relative))return;seen.add(relative);
 const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));
 fs.mkdirSync(path.dirname(dest),{recursive:true});
 let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
  if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
  let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
  if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';
  compile(source);return 'from '+JSON.stringify(path.join(out,source.replace(/\.tsx?$/,'.mjs')));
 });
 fs.writeFileSync(dest,code);
}
compile('lib/crm.ts');compile('lib/customer-edit-requests.ts');
const C=await import(pathToFileURL(path.join(out,'lib/customer-classification.mjs')));
const {schemas}=await import(pathToFileURL(path.join(out,'lib/crm.mjs')));
const edits=await import(pathToFileURL(path.join(out,'lib/customer-edit-requests.mjs')));
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const ARABIC=/[؀-ۿ]/;

// ---- The lists, as the owner gave them.
eq(C.OPPORTUNITY_GRADES.map(item=>[item.value,item.ar,item.helpAr]),[
 ['A','مرتفعة','اهتمام بالمنتج وصاحب القرار متفاعل وطلب عرض سعر'],
 ['B','متوسطة','يوجد اهتمام ولكن القرار مؤجل ويحتاج إلى دراسة'],
 ['C','ضعيفة','اهتمام محدود ولا توجد نية'],
 ['D','مستبعدة','رفض التعامل لارتباطه الكامل بالمورد'],
],'«تصنيف الفرصة»: A to D with their help');
eq(C.FACTORY_SIZES.map(item=>[item.value,item.ar]),[['A','كبير'],['B','متوسط'],['C','صغير'],['D','متوقف']],'«حجم المصنع»');
eq(C.CUSTOMER_INTERESTS.map(item=>[item.value,item.ar,item.helpAr]),[
 ['technical','فني','الجودة والأداء: مقارنة فنية'],
 ['price','سعري','السعر هو الحاسم: عرض سعر تنافسي'],
 ['service','خدمي','سرعة التوريد والصيانة وخدمات ما بعد البيع'],
 ['trust','الثقة','بناء علاقة مع العميل وعرض عملاء تعاملوا معنا'],
],'«اهتمام العميل»: one of four');
eq([...C.CLASSIFICATION_FIELDS],['opportunityGrade','gradeNotes','factorySize','customerInterest'],'the four stored fields');
for(const item of [...C.OPPORTUNITY_GRADES,...C.FACTORY_SIZES,...C.CUSTOMER_INTERESTS]){eq(ARABIC.test(item.en)||ARABIC.test(item.helpEn),false,'English without Arabic: '+item.en);eq(!!item.en&&!!item.helpEn,true,'English given: '+item.value);}
for(const [field,[ar,en]] of [...Object.entries(C.CLASSIFICATION_TEXT),...Object.entries(C.CLASSIFICATION_ALL_TEXT)])eq([ARABIC.test(ar),ARABIC.test(en)],[true,false],'the words of '+field);
eq(C.CLASSIFICATION_TEXT.customerType,undefined,'«تصنيف العميل» (customerType) is not one of them: it stays as it was');

// ---- The size the machines suggest: 0 to 6 machines.
eq([0,1,2,3,4,5,6].map(C.suggestedFactorySize),['','C','C','B','B','A','A'],'0 none, 1–2 C صغير, 3–4 B متوسط, 5 or more A كبير');
eq([-1,NaN,Infinity,100].map(C.suggestedFactorySize),['','','','A'],'nothing for a count that is not one; a large count is A');
eq([0,1,2,3,4,5,6,1000].some(count=>C.suggestedFactorySize(count)==='D'),false,'D «متوقف» is never suggested');
// A stored value always wins, D included; a value that is not a size never does.
eq(C.effectiveFactorySize('',3),{value:'B',suggested:true},'nothing stored: the suggestion, marked');
eq(C.effectiveFactorySize(undefined,6),{value:'A',suggested:true},'absent: the suggestion');
eq(C.effectiveFactorySize('C',6),{value:'C',suggested:false},'a stored size wins over 6 machines');
eq(C.effectiveFactorySize('D',6),{value:'D',suggested:false},'«متوقف» stored by hand wins');
eq(C.effectiveFactorySize('A',0),{value:'A',suggested:false},'a stored size with no machine');
eq(C.effectiveFactorySize('',0),{value:'',suggested:false},'no machine and nothing stored: no size');
eq(C.effectiveFactorySize('X',2),{value:'C',suggested:true},'a stored value that is not a size is not a size');
eq(C.effectiveFactorySize(' B ',0),{value:'B',suggested:false},'a stored value is read trimmed');
// The registered machines: records of kind factory under the customer.
const factory=(id,parentId,data={})=>({id,kind:'factory',parentId,data});
const records=[
 {id:'c1',kind:'customer',parentId:null,data:{}},
 factory('m1','c1',{recordType:'machine',quantity:1}),factory('m2','c1',{recordType:'machine'}),factory('m3','c1',{recordType:'group',quantity:3}),
 factory('m4','c1',{recordType:'group',quantity:null}),factory('m5','c2',{recordType:'machine',quantity:7}),factory('m6','c1',{recordType:'machine',quantity:0}),
 {id:'v1',kind:'activity',parentId:'c1',data:{quantity:9}},{id:'o1',kind:'opportunity',parentId:'m1',data:{quantity:4}},factory('m7','c1',{recordType:'machine',quantity:-2}),
];
eq(C.registeredMachineCount('c1',records),1+1+3+0+0+1,'one, a single machine with no number (one), a group of 3, a group of unknown size (none), a machine counted 0, a wrong number (one); visits and requests are not machines');
eq(C.registeredMachineCount('c2',records),7,'another customer\'s');
eq(C.registeredMachineCount('c3',records),0,'a customer with none');
eq(Object.fromEntries(C.registeredMachineCounts(records)),{c1:6,c2:7},'every customer\'s in one pass, the same counts');
eq(C.suggestedFactorySize(C.registeredMachineCount('c1',records)),'A','six registered machines suggest «كبير»');

// ---- The schema of a customer (POST /api/crm, the imports): unknown values refused with their message.
const base={name:'مصنع الاختبار',region:'الشرقية',branch:'الرئيسي',assignedTo:'rep'};
const parse=data=>schemas.customer.safeParse({...base,...data});
for(const [field,values] of [['opportunityGrade',['','A','B','C','D']],['factorySize',['','A','B','C','D']],['customerInterest',['','technical','price','service','trust']]])
 for(const value of values)eq(parse({[field]:value}).data?.[field],value,'accepted: '+field+' '+JSON.stringify(value));
eq(parse({opportunityGrade:' A ',customerInterest:'  price'}).data,{...parse({}).data,opportunityGrade:'A',customerInterest:'price'},'trimmed before it is checked');
for(const field of C.CLASSIFICATION_FIELDS)eq(field in parse({}).data,false,'optional: a save without '+field+' carries nothing (the route keeps the stored one)');
const refusals={opportunityGrade:C.GRADE_REFUSED,factorySize:C.SIZE_REFUSED,customerInterest:C.INTEREST_REFUSED};
for(const [field,message] of Object.entries(refusals))for(const bad of ['a','E','AB','A B','مرتفعة','كبير','Technical','x'.repeat(300),5,null,true,['A'],{value:'A'}]){
 const result=parse({[field]:bad});
 eq([result.success,result.error?.issues.map(issue=>issue.message)],[false,[message]],'refused with its message: '+field+' '+JSON.stringify(bad).slice(0,20));
}
eq(['technical','price','service','trust'].map(value=>parse({opportunityGrade:value}).success),[false,false,false,false],'an interest is not a grade');
eq(parse({factorySize:'technical'}).success,false,'nor a size');
eq(parse({gradeNotes:'س'.repeat(1000)}).data.gradeNotes.length,1000,'notes up to 1000');
eq(parse({gradeNotes:'  ملاحظة  '}).data.gradeNotes,'ملاحظة','notes trimmed');
eq(parse({gradeNotes:'س'.repeat(1001)}).error.issues.map(issue=>issue.message),[C.GRADE_NOTES_TOO_LONG],'over 1000 refused');
eq(parse({gradeNotes:7}).success,false,'notes are text');
eq(parse({customerType:'جملة',opportunityGrade:'B'}).data.customerType,'جملة','«تصنيف العميل» untouched beside them');

// ---- What a save keeps and changes.
const stored={name:'x',opportunityGrade:'A',gradeNotes:'ملاحظة',factorySize:'D',customerInterest:'price'};
let data={name:'x'};C.keepAbsentClassification(data,{name:'x'},stored);
eq(data,stored,'a save that does not carry them keeps every stored one');
data={name:'x',opportunityGrade:'B'};C.keepAbsentClassification(data,{name:'x',opportunityGrade:'B'},stored);
eq(data,{...stored,opportunityGrade:'B'},'one carried changes that one only');
data={name:'x',opportunityGrade:'',factorySize:''};C.keepAbsentClassification(data,{name:'x',opportunityGrade:'',factorySize:''},stored);
eq(data,{name:'x',gradeNotes:'ملاحظة',customerInterest:'price'},'an emptied one is removed (the size suggestion shows again)');
data={name:'x',opportunityGrade:'',factorySize:''};C.keepAbsentClassification(data,{name:'x',opportunityGrade:'',factorySize:''},undefined);
eq(data,{name:'x'},'a new customer with empty ones stores none');
eq(C.changedClassification(stored,{...stored}),[],'nothing changed');
eq(C.changedClassification(undefined,{name:'x'}),[],'a new customer without them changes nothing');
eq(C.changedClassification(undefined,{opportunityGrade:''}),[],'empty is nothing');
eq(C.changedClassification(stored,{...stored,gradeNotes:'أخرى',factorySize:undefined}),['gradeNotes','factorySize'],'the changed ones, absent counting as empty');
eq(C.withoutClassification(stored),{name:'x'},'what a representative reads of another\'s customer');
// A supervisor's request carries them; the edit requests show their words.
eq(edits.customerEditProposal({name:'x'},{name:'x',factorySize:'B',customerInterest:'trust'}).fields,['factorySize','customerInterest'],'a request holds the changed classifications');
eq(edits.CUSTOMER_EDIT_FIELD_TEXT.opportunityGrade,['تصنيف الفرصة','Opportunity grade'],'named in the list of requests');

// ---- The words.
eq(['A','B','C','D'].map(value=>C.classificationLabel('opportunityGrade',value)),['A · مرتفعة','B · متوسطة','C · ضعيفة','D · مستبعدة'],'the grades in Arabic');
eq(['A','B','C','D'].map(value=>C.classificationLabel('factorySize',value,'en')),['A · Large','B · Medium','C · Small','D · Stopped'],'the sizes in English');
eq(['technical','price','service','trust'].map(value=>C.classificationLabel('customerInterest',value,'en')),['Technical','Price','Service','Trust'],'the interests in English');
eq(C.classificationLabel('opportunityGrade',''),'','nothing for nothing');
eq(C.classificationLabel('opportunityGrade','Z'),'Z','an unknown value as it is (never stored)');
eq(C.classificationHelp('opportunityGrade','D','en'),'Refused to deal with us, being fully tied to their supplier','the help in English');
eq(C.classificationHelp('customerInterest','nope'),'','no help for an unknown value');

// ---- The filters of «العملاء».
const row=data=>data;
const filter=patch=>({...C.NO_CLASSIFICATION_FILTER,...patch});
eq(C.classificationFiltersSet(C.NO_CLASSIFICATION_FILTER),0,'none set');
eq(C.classificationFiltersSet(filter({opportunityGrade:'A',customerInterest:'none'})),2,'two set');
const sample=[[{opportunityGrade:'A',customerInterest:'price'},0],[{opportunityGrade:'B',factorySize:'D'},6],[{},4],[{},0],[{factorySize:'C'},6]];
const pick=patch=>sample.map(([data,machines],index)=>C.matchesClassification(row(data),machines,filter(patch))?index:null).filter(index=>index!==null);
eq(pick({}),[0,1,2,3,4],'no filter: everyone');
eq(pick({opportunityGrade:'A'}),[0],'by grade');
eq(pick({opportunityGrade:'none'}),[2,3,4],'not graded');
eq(pick({factorySize:'B'}),[2],'by size: the suggested one counts (4 machines)');
eq(pick({factorySize:'A'}),[],'a stored size wins over the machines (6 machines stored D, stored C)');
eq(pick({factorySize:'D'}),[1],'«متوقف»');
eq(pick({factorySize:'none'}),[0,3],'no size: nothing stored and no machine');
eq(pick({customerInterest:'price'}),[0],'by interest');
eq(pick({opportunityGrade:'B',factorySize:'D'}),[1],'together');
eq(pick({opportunityGrade:'A',customerInterest:'trust'}),[],'together, nothing');

console.log(JSON.stringify({ok:true,checks}));
