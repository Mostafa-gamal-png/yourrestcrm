// The classifications of a customer and the opportunity's grade (the owner, 2026-11-18, with «مسؤول تسويق», as he corrected them the same
// day: «تصنيف الفرصة ده موجود بالفعل بس هيزيد / تصنيف حجم المصنع ده بيتحسب من عدد ماكينات المتسجلة داخل المصنع / وهو هيدخل التصنيف العميل
// بناء على اهتماماته»), without a build: «قوة الفرصة» A to D (lib/opportunity-strength.ts: the three stored values keep their meaning and
// `excluded` is D; the words and help; the order of the customer-service queue; the schemas of a visit and of a service opportunity; the
// visits list's filter), «حجم المصنع» computed (lib/customer-classification.ts: the machines registered one by one, else the sheet's,
// never both; 5 or more A, 3–4 B, 1–2 C, none «غير محدد»; D from the status «خامل»; a stored size never read), «اهتمام العميل» by hand
// (unknown values refused, null empty, absent kept), the retired customer-level grade, notes and size carried exactly as stored, the
// words in Arabic and English (no Arabic left in English), the two filters of «العملاء» (a customer whose interest is hidden from the
// reader in no interest filter that is set), and the card, the sheet and the form drawn on the server. Pure rules on the real modules;
// no network, no real data.
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
 let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
  if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
  let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
  if(/\.json$/.test(source)){const target=path.join(out,source);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,source),target);return 'from '+JSON.stringify(target)+' with {type:"json"}';}
  if(/\.(mjs|js)$/.test(source))return 'from '+JSON.stringify(pathToFileURL(path.join(root,source)).href);
  if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';
  compile(source);return 'from '+JSON.stringify(path.join(out,source.replace(/\.tsx?$/,'.mjs')));
 });
 // The component's stylesheet is the page's; a module run here has no use for it.
 code=code.replace(/^import\s+(['"])[^'"]+\.css\1;?$/mg,'');
 fs.writeFileSync(dest,code);
}
compile('lib/crm.ts');compile('lib/customer-edit-requests.ts');compile('lib/opportunity-strength.ts');compile('lib/service-queue.ts');compile('lib/visit-list.ts');compile('lib/customer-service.ts');
const C=await import(pathToFileURL(path.join(out,'lib/customer-classification.mjs')));
const {schemas}=await import(pathToFileURL(path.join(out,'lib/crm.mjs')));
const edits=await import(pathToFileURL(path.join(out,'lib/customer-edit-requests.mjs')));
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;},ok=(value,message)=>{assert.ok(value,message);checks++;};
const ARABIC=/[؀-ۿ]/;
const strength=await import(pathToFileURL(path.join(out,'lib/opportunity-strength.mjs')));
const queue=await import(pathToFileURL(path.join(out,'lib/service-queue.mjs')));
const visitList=await import(pathToFileURL(path.join(out,'lib/visit-list.mjs')));
const service=await import(pathToFileURL(path.join(out,'lib/customer-service.mjs')));
const en=JSON.parse(fs.readFileSync(path.join(root,'lib/locales/en.json'),'utf8'));

// ---- «قوة الفرصة»: the owner's «تصنيف الفرصة», A to D, on each visit and service opportunity.
eq(strength.OPPORTUNITY_STRENGTHS.map(item=>[item.value,item.code,item.ar,item.helpAr]),[
 ['strong','A','مرتفعة','اهتمام بالمنتج وصاحب القرار متفاعل وطلب عرض سعر'],
 ['medium','B','متوسطة','يوجد اهتمام ولكن القرار مؤجل ويحتاج إلى دراسة'],
 ['weak','C','ضعيفة','اهتمام محدود ولا توجد نية'],
 ['excluded','D','مستبعدة','رفض التعامل لارتباطه الكامل بالمورد'],
],'A to D with the owner\'s descriptions: the three stored values keep their meaning, `excluded` is the new D');
eq([...strength.STRENGTH_VALUES],['strong','medium','weak','excluded'],'the stored values');
eq(strength.strengthLabels,{strong:'A · مرتفعة',medium:'B · متوسطة',weak:'C · ضعيفة',excluded:'D · مستبعدة'},'the words every list, chip and export writes, A to D in order');
eq(Object.keys(strength.strengthLabels),['strong','medium','weak','excluded'],'offered in that order');
eq(['strong','medium','weak','excluded','','X',null].map(value=>strength.strengthLabel(value,'en')),['A · High','B · Medium','C · Low','D · Excluded','','',''],'in English; nothing for no grade or an unknown value');
eq(strength.strengthHelp('excluded','en'),'Refused to deal with us, being fully tied to their supplier','the help in English');
for(const [value,label] of Object.entries(strength.strengthLabels))eq([!!en[label],ARABIC.test(en[label]||''),en[label]],[true,false,strength.strengthLabel(value,'en')],'the page translates '+label);
for(const item of strength.OPPORTUNITY_STRENGTHS)eq(ARABIC.test(item.en+item.helpEn),false,'English without Arabic: '+item.value);
// The customer-service queue: A, B, C, an opportunity with no grade, then D.
eq(['strong','medium','weak','','excluded','X',undefined].map(strength.strengthRank),[0,1,2,3,4,3,3],'the rank of each grade (no grade, or one not known, between C and D)');
const entry=(id,value,extra={})=>({id,awaiting:null,late:false,strength:value,stageSince:'2026-11-01',...extra});
eq(queue.sortQueue([entry('d','excluded'),entry('none',''),entry('c','weak'),entry('a','strong'),entry('b','medium')]).map(item=>item.id),['a','b','c','none','d'],'the queue: A, B, C, no grade, D');
eq(queue.sortQueue([entry('d','excluded',{awaiting:'assign'}),entry('a','strong'),entry('late-d','excluded',{late:true})]).map(item=>item.id),['d','late-d','a'],'what the reader must do and lateness still come first');
eq(queue.sortQueue([entry('d2','excluded',{stageSince:'2026-11-03'}),entry('d1','excluded',{stageSince:'2026-11-02'})]).map(item=>item.id),['d1','d2'],'two D: the older first');
// The schemas of a visit (POST /api/visits, /api/crm) and of a service opportunity (POST /api/customer-service).
const shapeOf=schema=>schema.shape||schema._def.schema.shape;
const visit=value=>shapeOf(schemas.activity).strength.safeParse(value);
eq(['strong','medium','weak','excluded','',undefined].map(value=>visit(value).success&&visit(value).data),['strong','medium','weak','excluded','',undefined],'a visit takes A to D or no grade');
eq(['X','D','مستبعدة','Excluded'].map(value=>visit(value).success),[false,false,false,false],'and nothing else (the code letter and the words are not values)');
const intake=shapeOf(service.serviceIntakeSchemaForDay()).strength;
eq(['strong','medium','weak','excluded'].map(value=>intake.safeParse(value).success),[true,true,true,true],'a customer-service opportunity takes A to D');
eq([intake.safeParse('').success,intake.safeParse('X').success],[false,false],'and must have one');
// The visits list's filter (lib/visit-list.ts, the table and its CSV).
const act=(id,value,day)=>({id,kind:'activity',parentId:null,assignedTo:'rep',branch:'الرئيسي',data:{type:'call',date:'2026-11-'+day,strength:value},createdAt:'2026-11-'+day+'T08:00:00.000Z',updatedAt:'',version:1});
const visits=[act('v-a','strong','10'),act('v-d','excluded','11'),act('v-none','','12'),act('v-c','weak','13'),act('v-odd','X','14')];
const listed=filter=>visitList.filterVisitRows(visits,{strength:filter}).map(row=>row.id).sort();
eq([listed('excluded'),listed('strong'),listed('none'),listed('all').length],[['v-d'],['v-a'],['v-none','v-odd'],5],'D alone; A alone; no grade (an unknown value counts as none); every visit');
eq(visitList.filterVisitRows(visits,{}).length,5,'no strength given: every visit, as before');
eq([strength.matchesStrength('excluded','excluded'),strength.matchesStrength('excluded','none'),strength.matchesStrength(undefined,'none'),strength.matchesStrength('weak','all')],[true,false,true,true],'matchesStrength');

// ---- The lists of the customer's classifications.
eq(C.FACTORY_SIZES.map(item=>[item.value,item.ar,item.helpAr]),[['A','كبير','5 ماكينات أو أكثر'],['B','متوسط','من 3 إلى 4 ماكينات'],['C','صغير','من ماكينة إلى ماكينتين'],['D','متوقف','حالة العميل «خامل»']],'«حجم المصنع»: from the machines, D from the status');
eq(C.CUSTOMER_INTERESTS.map(item=>[item.value,item.ar,item.helpAr]),[
 ['technical','فني','الجودة والأداء: مقارنة فنية'],
 ['price','سعري','السعر هو الحاسم: عرض سعر تنافسي'],
 ['service','خدمي','سرعة التوريد والصيانة وخدمات ما بعد البيع'],
 ['trust','الثقة','بناء علاقة مع العميل وعرض عملاء تعاملوا معنا'],
],'«اهتمام العميل»: one of four');
eq([[...C.CLASSIFICATION_FIELDS],[...C.RETIRED_CLASSIFICATION_FIELDS],[...C.MANUAL_CLASSIFICATION_FIELDS],[...C.CLASSIFICATION_FILTER_FIELDS]],[['opportunityGrade','gradeNotes','factorySize','customerInterest'],['opportunityGrade','gradeNotes','factorySize'],['customerInterest'],['factorySize','customerInterest']],'stored, retired, set by hand, filtered');
for(const item of [...C.FACTORY_SIZES,...C.CUSTOMER_INTERESTS]){eq(ARABIC.test(item.en)||ARABIC.test(item.helpEn),false,'English without Arabic: '+item.en);eq(!!item.en&&!!item.helpEn,true,'English given: '+item.value);}
for(const [field,[ar,en]] of [...Object.entries(C.CLASSIFICATION_TEXT),...Object.entries(C.CLASSIFICATION_ALL_TEXT),['computed',C.COMPUTED_SIZE_TEXT]])eq([ARABIC.test(ar),ARABIC.test(en)],[true,false],'the words of '+field);
eq(C.COMPUTED_SIZE_TEXT,['حجم المصنع (محسوب من الماكينات)','Factory size (computed from the machines)'],'the size is named as computed');

// The machines a customer has (the review of 2026-11-18: the sheet's machines reach the CRM twice, as the customer's «عدد الماكينات في
// الشيت» and, once imported, as the group record `<customer>:source-machines-v1` with the same count; the machines registered one by one
// afterwards are mostly among them). The count never adds them: the machines registered one by one when there is any, else the sheet's
// group, else the customer's own sheet count, else none.
const factory=(id,parentId,data={})=>({id,kind:'factory',parentId,data});
const customer=(id,data={})=>({id,kind:'customer',parentId:null,data});
const records=[
 customer('c1',{machineCount:3}),
 factory('m1','c1',{recordType:'machine',quantity:1}),factory('m2','c1',{recordType:'machine'}),factory('c1:source-machines-v1','c1',{recordType:'group',quantity:3}),
 factory('m4','c1',{recordType:'group',quantity:null}),factory('m6','c1',{recordType:'machine',quantity:0}),factory('m7','c1',{recordType:'machine',quantity:-2}),
 {id:'v1',kind:'activity',parentId:'c1',data:{quantity:9}},{id:'o1',kind:'opportunity',parentId:'m1',data:{quantity:4}},
 customer('c2'),factory('m5','c2',{recordType:'machine',quantity:7}),
 customer('c3',{machineCount:4}),
 customer('c4',{machineCount:5}),factory('c4:source-machines-v1','c4',{recordType:'group',quantity:5}),
 customer('c5',{machineCount:3}),factory('c5:source-machines-v1','c5',{recordType:'group',quantity:3}),factory('c5-a','c5',{recordType:'machine',quantity:1}),factory('c5-b','c5',{recordType:'machine',quantity:1}),
 customer('c6'),customer('c7',{machineCount:0}),customer('c8',{machineCount:'4'}),
];
eq(C.customerMachineCount('c1',records,3),{count:1+1+0+1,source:'machines'},'registered one by one: one, one with no number (one), one counted 0, a wrong number (one); the sheet\'s group and count are not added; visits and requests are not machines');
eq(C.customerMachineCount('c2',records),{count:7,source:'machines'},'another customer\'s, its number');
eq(C.customerMachineCount('c3',records,4),{count:4,source:'sheet'},'none registered and no group: the customer\'s own sheet count');
eq(C.customerMachineCount('c4',records,5),{count:5,source:'sheet'},'the sheet\'s group and the same sheet count: 5, never 10');
eq(C.customerMachineCount('c5',records,3),{count:2,source:'machines'},'two registered beside the sheet\'s group of 3: the two (they are among the three), never 5');
eq(C.customerMachineCount('c6',records),{count:0,source:'none'},'none at all');
eq([C.customerMachineCount('c7',records,0),C.customerMachineCount('c8',records,'4'),C.customerMachineCount('c8',records,-1)],[{count:0,source:'sheet'},{count:0,source:'none'},{count:0,source:'none'}],'a sheet count of 0 is a count; text or a negative is none');
eq(Object.fromEntries(C.customerMachineCounts(records)),{c1:{count:3,source:'machines'},c2:{count:7,source:'machines'},c3:{count:4,source:'sheet'},c4:{count:5,source:'sheet'},c5:{count:2,source:'machines'},c6:{count:0,source:'none'},c7:{count:0,source:'sheet'},c8:{count:0,source:'none'}},'every customer\'s in one pass, the same counts, the sheet count read from the customer');
eq([...C.customerMachineCounts([factory('x','gone',{recordType:'machine',quantity:2})])],[['gone',{count:2,source:'machines'}]],'machines of a customer the list does not hold are still counted');
eq(C.registeredMachineCount('c5',records,3),2,'the number alone, as the size reads it');
eq([C.sizeFromMachines(C.registeredMachineCount('c4',records,5)),C.sizeFromMachines(C.registeredMachineCount('c5',records,3))],['A','C'],'the sheet\'s five give «كبير»; the two registered «صغير» (the double count would have said «كبير»)');
eq(C.NO_MACHINES,{count:0,source:'none'},'the count of a customer with no entry');


// ---- «حجم المصنع», computed: never chosen, a stored value never read.
eq([0,1,2,3,4,5,6].map(C.sizeFromMachines),['','C','C','B','B','A','A'],'0 «غير محدد», 1–2 C صغير, 3–4 B متوسط, 5 or more A كبير');
eq([-1,NaN,Infinity,100].map(C.sizeFromMachines),['','','','A'],'nothing for a count that is not one; a large count is A');
const machines=(count,source='machines')=>({count,source});
eq(C.computedFactorySize({customerStatus:'خامل'},machines(6)),{value:'D',from:'status'},'D «متوقف» from the status «خامل», whatever the machines');
eq(['خامل',' خامل ','خامل','Inactive','inactive'].map(status=>C.computedFactorySize({customerStatus:status},machines(2)).value),['D','D','D','D','D'],'read as the map reads the status: spaces, Unicode forms, the English of an import');
eq(['نشط','نصف نشط','','غير معروف',undefined,5].map(status=>C.computedFactorySize({customerStatus:status},machines(3)).value),['B','B','B','B','B','B'],'any other status (none, unknown): from the machines');
eq(C.computedFactorySize({customerStatus:'نشط'},machines(0,'none')),{value:'',from:'none'},'no machines: «غير محدد»');
eq(C.computedFactorySize({customerStatus:'نصف نشط'},machines(5,'sheet')),{value:'A',from:'machines'},'the sheet\'s count when nothing is registered one by one');
eq([C.computedFactorySize({factorySize:'A'},machines(0,'none')).value,C.computedFactorySize({factorySize:'D'},machines(2)).value,C.computedFactorySize({factorySize:'C',customerStatus:'نشط'},machines(6)).value],['','C','A'],'a stored factorySize is never read (an A with no machine, a D with two, a C with six)');
eq(C.computedFactorySize(null,2),{value:'C',from:'machines'},'a bare number and no data');
eq([C.stoppedStatus('خامل'),C.stoppedStatus('نصف نشط'),C.stoppedStatus('')],[true,false,false],'stoppedStatus');
eq('effectiveFactorySize' in C||'suggestedFactorySize' in C,false,'no stored or suggested size left to read');

// ---- The schema of a customer (POST /api/crm, the imports).
const base={name:'مصنع الاختبار',region:'الشرقية',branch:'الرئيسي',assignedTo:'rep'};
const parse=data=>schemas.customer.safeParse({...base,...data});
for(const value of ['','technical','price','service','trust'])eq(parse({customerInterest:value}).data?.customerInterest,value,'accepted: customerInterest '+JSON.stringify(value));
eq(parse({customerInterest:'  price'}).data.customerInterest,'price','trimmed before it is checked');
eq('customerInterest' in parse({}).data,false,'optional: a save without it carries nothing (the route keeps the stored one)');
eq(parse({customerInterest:null}).data.customerInterest,'','null is empty');
for(const bad of ['a','Technical','سعري','x'.repeat(300),5,true,['price'],{value:'price'}])eq([parse({customerInterest:bad}).success,parse({customerInterest:bad}).error?.issues.map(issue=>issue.message)],[false,[C.INTEREST_REFUSED]],'refused with its message: '+JSON.stringify(bad).slice(0,20));
// The retired three: whatever comes passes the schema (a page or a device queue of the release that had them is not refused for them);
// the route then puts back exactly what is stored.
for(const [field,value] of [['opportunityGrade','E'],['opportunityGrade',5],['gradeNotes','س'.repeat(5000)],['gradeNotes',null],['factorySize','كبير'],['factorySize',{x:1}]])eq(parse({[field]:value}).success,true,'the retired '+field+' never refuses a save: '+JSON.stringify(value).slice(0,20));
const stored={name:'x',opportunityGrade:'A',gradeNotes:'ملاحظة قديمة',factorySize:'D',customerInterest:'price'};
let data={name:'x',opportunityGrade:'B',gradeNotes:'',factorySize:'A',customerInterest:'trust'};
eq(C.carryRetiredClassification(data,stored),{name:'x',opportunityGrade:'A',gradeNotes:'ملاحظة قديمة',factorySize:'D',customerInterest:'trust'},'a save carries the retired three exactly as stored, whatever it sends');
data={name:'x'};eq(C.carryRetiredClassification(data,stored),{name:'x',opportunityGrade:'A',gradeNotes:'ملاحظة قديمة',factorySize:'D'},'a save that sends none keeps them');
data={name:'x',opportunityGrade:'A',factorySize:'B'};eq(C.carryRetiredClassification(data,{name:'x'}),{name:'x'},'a customer that had none gets none');
data={name:'x',opportunityGrade:'A',gradeNotes:'n',factorySize:'B'};eq(C.carryRetiredClassification(data,undefined),{name:'x'},'nor does a new customer');
data={name:'x'};eq(C.carryRetiredClassification(data,{opportunityGrade:' b ',factorySize:7}),{name:'x',opportunityGrade:' b ',factorySize:7},'kept as stored, even an odd value, untouched');

// ---- What a save keeps and changes of the interest.
data={name:'x'};C.keepAbsentClassification(data,{name:'x'},stored);eq(data.customerInterest,'price','a save that does not carry the interest keeps the stored one');
data={name:'x',customerInterest:'service'};C.keepAbsentClassification(data,{name:'x',customerInterest:'service'},stored);eq(data.customerInterest,'service','one carried changes it');
data={name:'x',customerInterest:''};C.keepAbsentClassification(data,{name:'x',customerInterest:''},stored);eq('customerInterest' in data,false,'an emptied one is removed');
eq(C.changedClassification(stored,{...stored,opportunityGrade:'B',gradeNotes:'',factorySize:'A'}),[],'the retired three are never a change a member makes');
eq(C.changedClassification(stored,{...stored,customerInterest:'trust'}),['customerInterest'],'the interest is');
eq(C.changedClassification(undefined,{customerInterest:''}),[],'empty is nothing');
eq(C.withoutClassification(stored),{name:'x'},'what a reader without them gets');
eq(edits.customerEditProposal({name:'x'},{name:'x',customerInterest:'trust'}).fields,['customerInterest'],'a supervisor\'s request holds a changed interest');
eq(edits.CUSTOMER_EDIT_FIELD_TEXT.opportunityGrade,['تصنيف الفرصة','Opportunity grade'],'a request sent before the correction still names its fields');

// ---- The words.
eq(['A','B','C','D'].map(value=>C.classificationLabel('factorySize',value)),['A · كبير','B · متوسط','C · صغير','D · متوقف'],'the sizes in Arabic');
eq(['A','B','C','D'].map(value=>C.classificationLabel('factorySize',value,'en')),['A · Large','B · Medium','C · Small','D · Stopped'],'the sizes in English');
eq(['technical','price','service','trust'].map(value=>C.classificationLabel('customerInterest',value,'en')),['Technical','Price','Service','Trust'],'the interests in English');
eq([C.classificationLabel('customerInterest',''),C.classificationLabel('customerInterest','Z')],['','Z'],'nothing for nothing; an unknown value as it is');
eq(C.classificationHelp('customerInterest','nope'),'','no help for an unknown value');

// ---- The filters of «العملاء»: the computed size and the interest.
const filter=patch=>({...C.NO_CLASSIFICATION_FILTER,...patch});
eq(C.NO_CLASSIFICATION_FILTER,{factorySize:'all',customerInterest:'all'},'two filters');
eq([C.classificationFiltersSet(C.NO_CLASSIFICATION_FILTER),C.classificationFiltersSet(filter({factorySize:'A',customerInterest:'none'}))],[0,2],'how many are set');
const hidden={name:'c-rep2',customerStatus:'نشط',[C.CLASSIFICATION_HIDDEN]:true};
const sample=[[{customerInterest:'price',factorySize:'A'},machines(0,'none')],[{customerStatus:'خامل',factorySize:'A'},machines(6)],[{},machines(4)],[{},machines(0,'none')],[{customerInterest:'trust'},machines(2,'sheet')],[hidden,machines(3)]];
const pick=patch=>sample.map(([data,count],index)=>C.matchesClassification(data,count,filter(patch))?index:null).filter(index=>index!==null);
eq(pick({}),[0,1,2,3,4,5],'no filter: everyone');
eq(pick({factorySize:'A'}),[],'A: nobody (a stored A is not read; six machines of a «خامل» customer are D)');
eq(pick({factorySize:'D'}),[1],'D: the «خامل» customer');
eq(pick({factorySize:'B'}),[2,5],'B: four machines, and three of a customer whose interest is hidden (the size is computed from what everyone reads)');
eq(pick({factorySize:'C'}),[4],'C: the sheet\'s two');
eq(pick({factorySize:'none'}),[0,3],'«غير محدد»: no machine and an active status');
eq(pick({customerInterest:'price'}),[0],'by interest');
eq(pick({customerInterest:'none'}),[1,2,3],'no interest: the hidden customer is not listed');
eq(pick({customerInterest:'trust',factorySize:'C'}),[4],'together');
eq([C.classificationHidden(hidden),C.classificationHidden({name:'x'}),C.classificationHidden(null),C.classificationHidden({[C.CLASSIFICATION_HIDDEN]:'true'})],[true,false,false,false],'the marker, read only when it is true itself');
const marked={name:'x',opportunityGrade:'A',gradeNotes:'n',factorySize:'D',customerInterest:'price'};C.hideClassification(marked);
eq(marked,{name:'x',[C.CLASSIFICATION_HIDDEN]:true},'hideClassification removes the four and marks the customer');

// ---- The card, the sheet and the form (app/customer-classification-fields.tsx), drawn on the server.
compile('app/customer-classification-fields.tsx');
const fields=await import(pathToFileURL(path.join(out,'app/customer-classification-fields.mjs')));
const React=await import('react'),{renderToStaticMarkup}=await import('react-dom/server');
// Drawn on the server, a page is in Arabic (lib/i18n.ts's server snapshot); the English words are tried in the browser test.
const html=(component,props)=>renderToStaticMarkup(React.createElement(fields[component],props));
const words=markup=>markup.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const editor=html('CustomerClassificationEditor',{data:{name:'x',opportunityGrade:'A',gradeNotes:'سرية',factorySize:'A'},machines:machines(2),editable:true,onChange:()=>{}});
eq([editor.includes('data-classification="factorySize"'),editor.includes('data-classification="opportunityGrade"'),editor.includes('textarea'),words(editor).includes('اعتماد المقترح')],[false,false,false,false],'the form: no choice of size, no grade, no notes, no «اعتماد المقترح»');
eq([editor.includes('data-classification="customerInterest"'),(editor.match(/name="classification-customerInterest"/g)||[]).length],[true,5],'the interest is chosen (not set and four)');
ok(words(editor).includes('حجم المصنع (محسوب من الماكينات) C · صغير ماكينتان مسجلتان'),'the computed size, with why: '+words(editor).slice(0,120));
eq([words(editor).includes('سرية'),editor.includes('data-computed-size="C"')],[false,true],'the retired notes are not shown; the stored A is not the size');
const stopped=words(html('CustomerClassificationEditor',{data:{name:'x',customerStatus:'خامل'},machines:machines(6),editable:true,onChange:()=>{}}));
ok(stopped.includes('D · متوقف حالة العميل «خامل»'),'a «خامل» customer: D, from its status');
const said=[[1,'machines','ماكينة واحدة مسجلة'],[2,'machines','ماكينتان مسجلتان'],[3,'machines','3 ماكينات مسجلة'],[10,'machines','10 ماكينات مسجلة'],[11,'machines','11 ماكينة مسجلة'],[1,'sheet','ماكينة واحدة في الشيت'],[2,'sheet','ماكينتان في الشيت'],[5,'sheet','5 ماكينات في الشيت'],[12,'sheet','12 ماكينة في الشيت']];
for(const [count,source,text] of said)ok(words(html('CustomerClassificationSummary',{data:{name:'x'},machines:{count,source}})).includes(text),'the size names its count: '+text);
ok(words(html('CustomerClassificationSummary',{data:{name:'x'},machines:machines(0,'none')})).includes('غير محدد لا توجد ماكينات مسجلة ولا عدد في الشيت'),'none: «غير محدد» and why');
const readOnly=html('CustomerClassificationEditor',{data:{name:'x',customerInterest:'trust'},machines:machines(3),editable:false,onChange:()=>{}});
eq([readOnly.includes('data-classification-readonly'),readOnly.includes('<input'),words(readOnly).includes('الثقة'),words(readOnly).includes('يحدد اهتمام العميل مسؤول التسويق')],[true,false,true,true],'read only: no field, the interest and who sets it');
const hiddenSummary=words(html('CustomerClassificationSummary',{data:hidden,machines:machines(3)}));
eq([hiddenSummary.includes('B · متوسط'),hiddenSummary.includes('اهتمام العميل')],[true,false],'a customer whose interest is hidden: its computed size, no interest');
eq(words(html('CustomerClassificationBadges',{data:hidden,machines:machines(3)})),'الحجم: B · متوسط','its card: the size only');
eq(words(html('CustomerClassificationBadges',{data:{customerInterest:'price',factorySize:'A',opportunityGrade:'A'},machines:machines(1)})),'الحجم: C · صغير الاهتمام: سعري','a card: the computed size and the interest, nothing of the retired grade or size');
eq(html('CustomerClassificationBadges',{data:{factorySize:'A'},machines:machines(0,'none')}),'','nothing to mark: no card mark at all');

console.log(JSON.stringify({ok:true,checks}));
