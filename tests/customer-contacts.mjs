// «المسؤولون» of a customer and the customer form of 2026-11-21 (the owner approved the mockup: six numbered sections, several contacts,
// «الداتا اللى فى الفورم القديمة كلها مهمة»), without a build, on the real modules (lib/customer-contacts.ts, lib/crm.ts,
// lib/customer-edit-requests.ts, lib/customer-map-search.ts, app/customer-form.tsx, app/customer-contacts-list.tsx): the primary is the
// customer's own contact, phone and email, the second its «المسؤول الثاني», the rest data.contacts; the roles are keys with words in Arabic
// and English; a contact with nothing in it is dropped, an unknown role, a bad email and more than ten refused with their words; a save that
// does not carry the contacts or the roles (a page or a device queue of the release before) keeps them; a second left empty with others after
// it takes the first of them; the edit requests carry them and show them as words; the searches find the others' names and phones; the
// export's line; the editor, the sheet's list and the sections drawn on the server; and the form keeps every field of the earlier one. No
// network, no real data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'customer-contacts-')),seen=new Set();
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
const C=await load('lib/customer-contacts.ts');
const {schemas}=await load('lib/crm.ts');
const edits=await load('lib/customer-edit-requests.ts');
const mapSearch=await load('lib/customer-map-search.ts');
const en=JSON.parse(fs.readFileSync(path.join(root,'lib/locales/en.json'),'utf8'));
const ARABIC=/[؀-ۿ]/;
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;},ok=(value,message)=>{assert.ok(value,message);checks++;};

// ---- The roles.
eq(C.CONTACT_TITLES.map(item=>[item.value,item.ar]),[['factory_manager','مدير المصنع'],['owner','المالك'],['purchasing','المشتريات'],['production','مسؤول الإنتاج'],['accountant','المحاسب'],['other','أخرى']],'the six roles, stored as keys');
for(const item of C.CONTACT_TITLES)ok(ARABIC.test(item.ar)&&!ARABIC.test(item.en)&&item.en,'the words of '+item.value);
eq([C.contactTitleLabel('owner'),C.contactTitleLabel('owner','en'),C.contactTitleLabel('nonsense'),C.contactTitleLabel(undefined)],['المالك','Owner','',''],'a role\'s words');

// ---- Where each contact lives.
const stored={name:'مصنع',contact:'م. خالد',contactTitle:'factory_manager',phone:'0551234567',email:'k@factory.example',contact2:'أ. سعد',phone2:'0509876543',email2:'',contacts:[{name:'سارة',title:'accountant',phone:'0533333333',email:''},{name:'',title:'',phone:'',email:''}]};
eq(C.customerContacts(stored),[{name:'م. خالد',title:'factory_manager',phone:'0551234567',email:'k@factory.example'},{name:'أ. سعد',title:'',phone:'0509876543',email:''},{name:'سارة',title:'accountant',phone:'0533333333',email:''}],'the primary (the customer\'s own fields), the second («المسؤول الثاني»), the rest (an empty one left out)');
eq(C.customerContacts({name:'قديم',contact:'علي',phone:'0500000000'}),[{name:'علي',title:'',phone:'0500000000',email:''}],'a customer of before: its contact as the primary, nothing lost');
eq(C.customerContacts({}),[{name:'',title:'',phone:'',email:''}],'none: an empty primary to fill');
eq(C.customerContacts({contact2:'ثاني'}).length,2,'a second alone is kept');
const list=C.customerContacts(stored);
eq(C.contactsData(list),{contact:'م. خالد',contactTitle:'factory_manager',phone:'0551234567',email:'k@factory.example',contact2:'أ. سعد',contactTitle2:'',phone2:'0509876543',email2:'',contacts:[{name:'سارة',title:'accountant',phone:'0533333333',email:''}]},'written back into the same fields');
eq(C.contactsData([list[2],list[0],list[1]]).contact,'سارة','«اجعله الأساسي»: the chosen contact becomes the customer\'s own contact');
eq(C.contactsData([list[0]]),{contact:'م. خالد',contactTitle:'factory_manager',phone:'0551234567',email:'k@factory.example',contact2:'',contactTitle2:'',phone2:'',email2:'',contacts:[]},'the others deleted: the second\'s fields emptied, no others');
eq([C.otherContacts(stored).length,C.extraContacts(stored).map(contact=>contact.name),C.otherContactsSearch(stored)],[2,['سارة'],['سارة','0533333333']],'the others, the third onward, and what the searches read');
eq(C.contactsText(C.otherContacts(stored)),'أ. سعد 0509876543؛ سارة (المحاسب) 0533333333','one line (the export)');
eq(C.contactsText(C.otherContacts(stored),'en'),'أ. سعد 0509876543; سارة (Accountant) 0533333333','in English: the roles\' words, the names as typed');

// ---- The schema (lib/crm.ts): the roles and the list.
const base={name:'مصنع',branch:'الرئيسي',assignedTo:'rep1'};
let parsed=schemas.customer.parse({...base,contactTitle:'owner',contactTitle2:'',contacts:[{name:' سارة ',title:'accountant',phone:'٠٥٣',email:'s@x.example'},{name:'',phone:'',email:''},{name:'',title:'other',phone:'',email:''}]});
eq([parsed.contactTitle,parsed.contactTitle2,parsed.contacts],['owner','',[{name:'سارة',title:'accountant',phone:'٠٥٣',email:'s@x.example'}]],'read: trimmed, a contact with nothing in it (a role alone) dropped');
const absent=schemas.customer.parse(base);
eq(['contactTitle','contactTitle2','contacts'].map(key=>key in absent),[false,false,false],'absent: absent (the route keeps what is stored)');
eq(schemas.customer.parse({...base,contacts:null}).contacts,[],'null: none');
const refused=(data,message,label)=>{const result=schemas.customer.safeParse({...base,...data});eq([result.success,result.success?'':result.error.issues.map(issue=>issue.message).join(' • ')],[false,message],label);};
refused({contactTitle:'boss'},C.CONTACT_TITLE_REFUSED,'an unknown role');
refused({contacts:[{name:'x',title:'boss'}]},C.CONTACT_TITLE_REFUSED,'an unknown role in the list');
refused({contacts:[{name:'x',email:'not-an-email'}]},C.CONTACT_EMAIL_REFUSED,'a bad email');
refused({contacts:Array.from({length:9},(_,i)=>({name:'م'+i}))},C.CONTACTS_TOO_MANY,'more than ten in all (eight beyond the two)');
eq(schemas.customer.parse({...base,contacts:Array.from({length:8},(_,i)=>({name:'م'+i}))}).contacts.length,8,'ten in all: accepted');
refused({contacts:[{name:'x'.repeat(251)}]},C.CONTACT_TOO_LONG,'a name over 250');
refused({contacts:'سارة'},C.CONTACTS_TOO_MANY,'not a list');
refused({email:'bad'},'Invalid email','the primary\'s email keeps its earlier rule');

// ---- A save that does not carry them keeps them; the second always the second.
let data={name:'مصنع',contact:'م. خالد',contact2:'أ. سعد'};C.keepAbsentContacts(data,{name:'مصنع',contact:'م. خالد',contact2:'أ. سعد'},stored);
eq([data.contactTitle,data.contactTitle2,data.contacts],['factory_manager',undefined,stored.contacts],'a page or a device queue of the release before: the roles and the others kept exactly');
data={name:'x',contact2:'',phone2:'',email2:'',contacts:[{name:'سارة',title:'accountant',phone:'053',email:''},{name:'منى',title:'',phone:'',email:''}]};C.keepAbsentContacts(data,{contacts:data.contacts,contactTitle2:''},undefined);
eq([data.contact2,data.contactTitle2,data.phone2,data.contacts],['سارة','accountant','053',[{name:'منى',title:'',phone:'',email:''}]],'a second left empty with others after it: the first of them takes its place');
data={name:'x',contact2:'',contactTitle2:'owner',contacts:[]};C.keepAbsentContacts(data,{contacts:[],contactTitle2:'owner'},undefined);
eq(['contactTitle2' in data,'contacts' in data],[false,false],'a role with no second: dropped; no others: no key');
data={name:'x',contactTitle:'',contacts:[]};C.keepAbsentContacts(data,{contactTitle:'',contacts:[]},{contactTitle:'owner',contacts:[{name:'a',title:'',phone:'',email:''}]});
eq(['contactTitle' in data,'contacts' in data],[false,false],'emptied by a save that carries them: removed');

// ---- The edit requests (lib/customer-edit-requests.ts): they travel in a request and read as words.
for(const field of ['contactTitle','contactTitle2','contacts'])ok(edits.CUSTOMER_EDIT_FIELDS.includes(field)&&edits.CUSTOMER_EDIT_FIELD_TEXT[field]&&!ARABIC.test(edits.CUSTOMER_EDIT_FIELD_TEXT[field][1]),field+' travels in a request, named in both languages');
eq(edits.CUSTOMER_EDIT_FIELDS.some(field=>edits.CUSTOMER_EDIT_LOCKED.includes(field)),false,'no locked field is a request field');
const before={contact:'م. خالد',contacts:[{name:'سارة',title:'accountant',phone:'053',email:''}]},after={contact:'م. خالد',contactTitle:'owner',contacts:[{name:'سارة',title:'accountant',phone:'053',email:''},{name:'منى',title:'',phone:'054',email:''}]};
const proposal=edits.customerEditProposal(before,after);
eq(proposal.fields,['contactTitle','contacts'],'the role and the list changed');
eq(proposal.base.contacts,JSON.stringify(before.contacts),'the list held as its JSON');
eq(edits.customerEditProposal(before,{...before,contacts:[{name:'سارة',title:'accountant',phone:'053',email:''}]}).fields,[],'the same list: no change');
eq([edits.editText([]),edits.editText([{name:'a'}])],['','[{"name":"a"}]'],'an empty list is empty');
eq(edits.editValueText('contacts',JSON.stringify(after.contacts)),'سارة (المحاسب) 053؛ منى 054','shown as words');
eq([edits.editValueText('contactTitle','owner'),edits.editValueText('contactTitle','owner','en'),edits.editValueText('notes','x')],['المالك','Owner','x'],'a role by its words, anything else as it is');
eq(edits.applyCustomerEdit({contact:'م. خالد',contacts:before.contacts},{fields:proposal.fields,values:proposal.values}),{contact:'م. خالد',contactTitle:'owner',contacts:after.contacts},'applied at the approval');
eq(edits.applyCustomerEdit({contact:'x',contacts:before.contacts},{fields:['contacts'],values:{contacts:null}}),{contact:'x'},'the others removed by an approved request');

// ---- The searches: the map's (lib/customer-map-search.ts) finds the others by name and phone.
const row=(id,data)=>({id,kind:'customer',parentId:null,assignedTo:'rep',branch:'الرئيسي',data,createdAt:'',updatedAt:'',version:1});
const customers=[row('a',{name:'مصنع الأمل',contact:'خالد',contacts:[{name:'سارة القحطاني',title:'',phone:'0533333333',email:''}]}),row('b',{name:'مصنع النور',contact:'منى'})];
const ids=query=>mapSearch.searchMapCustomers(customers,query).map(item=>item.id);
eq(ids('سارة'),['a'],'the map\'s search: another contact\'s name');eq(ids('0533333333'),['a'],'and phone');
const app=fs.readFileSync(path.join(root,'app/crm-app.tsx'),'utf8'),picker=fs.readFileSync(path.join(root,'app/visit-customer-picker.tsx'),'utf8');
ok(app.includes("...(r.kind === 'customer' ? otherContactsSearch(r.data) : [])"),'the customers page\'s search reads the others');
ok(picker.includes('...otherContactsSearch(customer.data)'),'and the visit\'s customer picker');
ok(app.includes("[say('مسؤولون إضافيون','Additional contacts'), r => contactsText(extraContacts(r.data), language)]")&&app.includes("[say('صفة المسؤول الأول','First contact role')"),'the export: the roles and the others in one column');
const route=fs.readFileSync(path.join(root,'app/api/crm/route.ts'),'utf8');
ok(/keepAbsentCapacity\(data,inputData,old\?\.data\);[\s\S]{0,400}keepAbsentContacts\(data,inputData,old\?\.data\);/.test(route),'POST /api/crm keeps the contacts and the roles a save does not carry');

// ---- The form keeps every field of the earlier one (app/crm-app.tsx), in its six sections.
const block=app.slice(app.indexOf("{form.kind === 'customer' && <div className=\"customer-form full\""),app.indexOf("{form.kind === 'factory' && <>"));
for(const needle of ["field('name', 'اسم المصنع', 'text', true, true)","only={['customerKind', 'category']}","only={['customerType', 'customerStatus']}","CustomerContactsEditor","field('city', 'المدينة')","field('address', 'العنوان')","<CustomerLocationFields compact","CustomerRegionField","CustomerClassificationEditor","pickField('assignedTo', 'المندوب المسؤول'","field('branch', 'فرع يورست المسؤول', 'plain', true)","CustomerCapacityFields","field('supplier', 'مورد القوالب والقطع')","field('machineCount', 'عدد الماكينات في الشيت', 'number')","field('machineTypes', 'أنواع الماكينات في الشيت')","field('notes', 'ملاحظات المصنع', 'textarea', false, true)","ErpCodeReadOnly","internalCode","customerEditRequest"])ok(block.includes(needle),'the form keeps '+needle);
eq([...block.matchAll(/<CustomerFormSection step=\{(\d)\}/g)].map(match=>Number(match[1])),[1,2,3,4,5,6],'six numbered sections');
eq(block.includes('customer-extra-fields')||block.includes('<details'),false,'nothing hidden under «بيانات إضافية»');
ok(app.includes("customerStatus: 'نشط', category: ''"),'a new customer starts «نشط»');

// ---- Drawn on the server (Arabic).
const React=await import('react'),{renderToStaticMarkup}=await import('react-dom/server');
const form=await load('app/customer-form.tsx'),sheet=await load('app/customer-contacts-list.tsx');
const html=(component,props)=>renderToStaticMarkup(React.createElement(component,props));
const words=markup=>markup.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const editor=html(form.CustomerContactsEditor,{data:stored,onChange:()=>{},contextKey:'k'});
eq((editor.match(/data-contact-index="/g)||[]).length,3,'the editor: three contacts');
eq([(editor.match(/data-contact-primary/g)||[]).length,(editor.match(/اجعله الأساسي/g)||[]).length,(editor.match(/>حذف</g)||[]).length],[1,2,2],'the primary marked; «اجعله الأساسي» and «حذف» on the others');
ok(editor.includes('aria-label="جوال المسؤول 1"')&&editor.includes('value="0551234567"')&&editor.includes('value="k@factory.example"')&&editor.includes('type="email"')&&editor.includes('type="tel"'),'each contact\'s mobile and email');
ok(words(editor).includes('إضافة مسؤول آخر'),'«إضافة مسؤول آخر»');
const ten=html(form.CustomerContactsEditor,{data:{...stored,contacts:Array.from({length:8},(_,i)=>({name:'م'+i}))},onChange:()=>{},contextKey:'k'});
ok(/<button[^>]*class="customer-contact-add"[^>]*disabled=""/.test(ten)&&words(ten).includes('عشرة مسؤولين على الأكثر'),'ten: no more is added');
const sheetList=html(sheet.CustomerContactsList,{data:stored});
eq((sheetList.match(/<li /g)||[]).length,3,'the sheet: every contact');
ok(sheetList.includes('href="tel:0551234567"')&&sheetList.includes('href="https://wa.me/966551234567"')&&sheetList.includes('href="mailto:k@factory.example"')&&words(sheetList).includes('مدير المصنع')&&words(sheetList).includes('الأساسي'),'with call, WhatsApp and email, the role and the primary marked');
eq(html(sheet.CustomerContactsList,{data:{name:'x'}}),'','no contact: nothing');
const section=html(form.CustomerFormSection,{step:5,title:['الطاقة والاحتياج','Capacity and demand'],note:['اختياري','Optional'],wide:true,children:React.createElement('p',null,'x')});
ok(section.includes('data-customer-section="5"')&&section.includes('class="customer-form-section wide"')&&words(section).startsWith('5 الطاقة والاحتياج اختياري'),'a numbered section');
eq(form.CUSTOMER_FORM_SECTIONS.map(([ar,enText])=>[ARABIC.test(ar),ARABIC.test(enText)]),Array(6).fill([true,false]),'the six titles in both languages');

console.log(JSON.stringify({ok:true,checks}));
