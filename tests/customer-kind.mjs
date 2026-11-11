// «تصنيف العميل» and «نوع العميل» (the owner, 2026-11-10): the field data.customerType is now labelled «تصنيف العميل» and no longer offers
// «خدمات» (a customer already classified so keeps it, shown and chosen in its own form only); the new optional data.customerKind
// («نوع العميل»: مصنع، مؤسسة، شركة، محل تجاري or empty) is checked by every customer schema (the sales form's schemas.customer and customer
// service's serviceCustomerSchema). The labels on the screens, the CSV export and English; the products application's customer list is
// unchanged. Pure rules and source reading only; no build, no network, no real data.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import assert from 'node:assert/strict';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'customer-kind-')),seen=new Set();
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
compile('lib/customer-service.ts');
const options=await import(path.join(out,'lib/customer-options.mjs'));
const {schemas,customerKindField}=await import(path.join(out,'lib/crm.mjs'));
const {serviceCustomerSchema}=await import(path.join(out,'lib/customer-service.mjs'));
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

// ---- the choices
eq([...options.customerTypes],['دوليون','مميزون','جملة','قطاعي','تجاري'],'«تصنيف العميل» offers five: «خدمات» is gone');
eq([...options.retiredCustomerTypes],['خدمات'],'«خدمات» is kept as a retired classification');
eq([...options.customerKinds],['مصنع','مؤسسة','شركة','محل تجاري'],'«نوع العميل»: exactly the owner\'s four');
eq(['','مصنع','مؤسسة','شركة','محل تجاري'].map(options.isCustomerKind),[true,true,true,true,true],'empty or one of the four');
eq(['خدمات','Factory','مصنع ',' ','محل','شركه',null,undefined,1].map(options.isCustomerKind),Array(9).fill(false),'anything else is not a customer type (a trailing space is trimmed by the schema first)');
// a stored value no longer offered stays in that customer's own choices, after the offered ones; nothing else is added
eq(options.choicesWithCurrent(options.customerTypes,'خدمات'),['دوليون','مميزون','جملة','قطاعي','تجاري','خدمات'],'a customer classified «خدمات» still has it in its form');
eq(options.choicesWithCurrent(options.customerTypes,'جملة'),[...options.customerTypes],'an offered value adds nothing');
eq(options.choicesWithCurrent(options.customerTypes,''),[...options.customerTypes],'empty adds nothing');
eq(options.choicesWithCurrent(options.customerTypes,undefined),[...options.customerTypes],'absent adds nothing');
eq(options.choicesWithCurrent(options.customerTypes,{x:1}),[...options.customerTypes],'a value that is not text adds nothing');
eq(options.choicesWithCurrent(options.customerKinds,'مصنع'),[...options.customerKinds]);

// ---- the sales form's schema (POST /api/crm, the ERP and one-time imports)
const base={name:'مصنع اختبار',region:'الشرقية',branch:'الرئيسي',assignedTo:'rep'};
const parse=data=>schemas.customer.safeParse({...base,...data});
for(const kind of ['','مصنع','مؤسسة','شركة','محل تجاري'])eq(parse({customerKind:kind}).data?.customerKind,kind,'accepted: «'+kind+'»');
eq(parse({customerKind:'  شركة  '}).data?.customerKind,'شركة','trimmed before it is checked');
eq('customerKind' in parse({}).data,false,'optional: a save without it carries no value (the route keeps the stored one)');
for(const bad of ['خدمات','Company','محل','x'.repeat(300),5,null]){
 const result=parse({customerKind:bad});eq(result.success,false,'refused: '+JSON.stringify(bad).slice(0,20));
}
eq(parse({customerKind:'خدمات'}).error.issues.map(issue=>issue.message),['اختر نوع العميل من القائمة: مصنع، مؤسسة، شركة، محل تجاري'],'with the list in the message');
eq([5,null,'x'.repeat(300)].map(bad=>parse({customerKind:bad}).error.issues.map(issue=>issue.message)),Array(3).fill(['اختر نوع العميل من القائمة: مصنع، مؤسسة، شركة، محل تجاري']),'the same message for a number, null or a long text');
// «تصنيف العميل» stays free text as it always was: a stored «خدمات» (or an imported text) is never refused on an unrelated edit
eq(parse({customerType:'خدمات'}).data?.customerType,'خدمات','a stored «خدمات» saves unchanged');
eq(parse({customerType:'مصنع'}).data?.customerType,'مصنع','an imported free-text classification saves unchanged');
eq(customerKindField.safeParse('مؤسسة').success,true);

// ---- customer service's new customer (admin only, POST /api/customer-service): strict, the same rule
const service=data=>serviceCustomerSchema.safeParse({name:'عميل',phone:'0500000000',region:'الشرقية',...data});
eq(service({}).data.customerKind,'','customer service: empty by default');
eq(service({customerKind:'محل تجاري'}).data.customerKind,'محل تجاري','customer service: one of the four');
eq(service({customerKind:'خدمات'}).success,false,'customer service: anything else refused');
eq(service({customerType:'خدمات'}).success,true,'customer service: the classification is free text as before');

// ---- the screens, the export and English
const fields=read('app/customer-entry-fields.tsx'),app=read('app/crm-app.tsx'),visits=read('app/customer-visits.tsx'),picker=read('app/visit-customer-picker.tsx');
eq(/\['customerType','تصنيف العميل',customerTypes\],\s*\['customerKind','نوع العميل',customerKinds\]/.test(fields),true,'the form: «تصنيف العميل» then «نوع العميل» next to it');
eq(fields.includes('choicesWithCurrent(choices,data[key])'),true,'the form keeps a stored value no longer offered');
eq(app.includes("'تصنيف العميل': detail.data.customerType, 'نوع العميل': detail.data.customerKind"),true,'the customer sheet shows both');
eq(app.includes("'customerType', 'customerKind', 'customerStatus'")&&app.includes("say('تصنيف العميل','Customer classification'), say('نوع العميل','Customer type')"),true,'the CSV export has both columns, renamed');
eq(app.includes("customerType: '', customerKind: ''"),true,'a new customer from the customers page starts empty');
eq(picker.split("customerType: '', customerKind: ''").length-1,2,'a new customer from the visit form starts empty');
eq(visits.includes("'تصنيف العميل':customer.data.customerType,'نوع العميل':customer.data.customerKind"),true,'the visit form\'s customer card shows both');
eq(/'نوع العميل'\s*:\s*(detail|customer)\.data\.customerType/.test(app+visits),false,'«نوع العميل» never labels the classification any more');
const english=JSON.parse(read('lib/locales/en.json'));
eq(['تصنيف العميل','نوع العميل','مصنع','مؤسسة','شركة','محل تجاري','خدمات','اختر نوع العميل من القائمة: مصنع، مؤسسة، شركة، محل تجاري'].map(key=>english[key]),
 ['Customer classification','Customer type','Factory','Establishment','Company','Retail shop','Services','Choose the customer type from the list: Factory, Establishment, Company, Retail shop'],'English for the labels, the choices, the retired value and the refusal');
// the route keeps a stored customerKind when a save leaves it out
eq(/if\(old&&inputData\?\.customerKind===undefined\)\{if\(typeof old\.data\.customerKind==='string'\)data\.customerKind=old\.data\.customerKind;else delete data\.customerKind;\}/.test(read('app/api/crm/route.ts')),true,'POST /api/crm keeps the stored type when the save has none');
// the products application's customer list (the contract with it) carries no customer type
for(const file of fs.readdirSync(path.join(root,'lib')).filter(name=>name.startsWith('mold-customers')))eq(read('lib/'+file).includes('customerKind'),false,file+': the products contract is unchanged');

console.log(JSON.stringify({ok:true,checks}));
