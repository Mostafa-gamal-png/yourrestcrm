// The complaint components rendered from the real source: the page each role sees and the panel on the Visits page, the
// registration form, the complaint sheet with the actions each reader is offered, the customer's own list and the navigation
// count, in Arabic and in English. Render contracts only: no browser, no network, no production data. (Clicks, requests and
// refreshes are exercised in tests/complaints-browser.mjs.)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
const root=process.cwd(),nativeRequire=createRequire(import.meta.url),libs=new Map(),apps=new Map();
const compiler={module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true};
let checks=0,language='ar';
// The project's modules run in their own context, so their arrays and objects are compared by value, not by realm.
const eq=(a,b,message)=>{assert.deepEqual(a===undefined?undefined:JSON.parse(JSON.stringify(a)),b,message);checks++;},ok=(value,message)=>{assert.ok(value,message);checks++;};
const dictionary=JSON.parse(fs.readFileSync(path.join(root,'lib/locales/en.json'),'utf8'));
const i18n={t:value=>language==='en'&&typeof value==='string'?(dictionary[value]||value):value,useLanguage:()=>({language}),getLanguage:()=>language,direction:()=>language==='en'?'ltr':'rtl'};
const pass=({children})=>children,mock=new Proxy({},{get:()=>pass});
function library(filename){
 if(libs.has(filename))return libs.get(filename);
 const exports={};libs.set(filename,exports);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,filename),'utf8'),{compilerOptions:compiler}).outputText,{exports,require:name=>name.startsWith('.')?library(path.join(path.dirname(filename),name)+'.ts'):name==='react'?React:nativeRequire(name),Date,Intl,console,crypto,URL,Promise,setTimeout,clearTimeout},{filename});
 return exports;
}
/** A component file with real React, the translating i18n and the project's own libraries; sibling components are loaded for real, styles and UI primitives are pass-through mocks. */
function load(filename){
 if(apps.has(filename))return apps.get(filename);
 const exports={};apps.set(filename,exports);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,filename),'utf8'),{compilerOptions:compiler}).outputText,{exports,require:name=>{
  if(name==='react')return React;
  if(name==='react/jsx-runtime')return jsx;
  if(name==='@/lib/i18n')return i18n;
  if(name.startsWith('@/lib/'))return library(name.replace('@/','')+'.ts');
  if(name.startsWith('./')&&!name.endsWith('.css')&&fs.existsSync(path.join(root,'app',name.slice(2)+'.tsx')))return load('app/'+name.slice(2)+'.tsx');
  return mock;
 },console,Date,Intl,crypto,URL,Promise,setTimeout,clearTimeout,window:undefined,navigator:undefined});
 return exports;
}
const C=library('lib/complaints.ts');
const {ComplaintsList,ComplaintRegisterDialog,ComplaintSheet,CustomerComplaints}=load('app/complaints-panel.tsx');
const MobileNavigation=load('app/mobile-navigation.tsx').default;
const html=element=>renderToStaticMarkup(element);
const count=(source,part)=>source.split(part).length-1;
const arabicLeft=source=>(source.replace(/<[^>]+>/g,' ').match(/[؀-ۿ]+/g)||[]);
const noop=()=>{};

// ---- a synthetic company and its complaints, the same rules as production
const m=(id,name,role,supervisorId,regionScope='all',branch='Main',active=1)=>({id,userId:'u-'+id,email:id+'@yourrest.org',name,role,branch,supervisorId,regionScope,active,target:0});
const members=[m('owner','Admin','admin'),m('sm','Sales Manager','manager'),m('sup','Supervisor','supervisor','sm'),m('rep','Rep One','rep','sup'),m('rep2','Rep Two','rep','sup'),m('csm','CS Manager','customer_service_manager','sm'),m('cs_east','CS East','customer_service','csm','eastern'),m('cs_west','CS West','customer_service','csm','western')];
const customer=(id,name,assignedTo,region)=>({id,kind:'customer',parentId:null,assignedTo,branch:'Main',data:{name,region,phone:'0551234567',city:'Dammam',contact:'Abu Khalid',internalCode:'YR-C-0000'+id.slice(-1)},createdAt:'2026-08-01T05:00:00.000Z',updatedAt:'2026-08-01T05:00:00.000Z',version:2});
const customers=[customer('c-1','Factory One','rep','الشرقية'),customer('c-2','Factory Two','rep2','الغربية')];
const now='2026-10-14T09:00:00.000Z',RECENT='2026-10-14T06:00:00.000Z',LATE='2026-10-13T12:00:00.000Z',OLD='2026-10-08T05:00:00.000Z';
const base={kind:'complaint',customerId:'c-1',status:'submitted',registrarId:'cs_east',serviceManagerId:'csm',salesManagerId:'',supervisorId:'',assigneeId:'',channel:'call',category:'product_quality',severity:'normal',description:'The mold produces a broken block on its right side',demand:'Replace the mold',reference:'INV-100',contactName:'Abu Khalid',contactPhone:'0551234567',
 submittedAt:RECENT,forwardedAt:'',returnedAt:'',assignedAt:'',delegatedAt:'',reassignedAt:'',rejectedAt:'',reopenedAt:'',resolvedAt:'',closedAt:'',cancelledAt:'',seenAt:'',returnNote:'',assignmentNote:'',rejectReason:'',cancelReason:'',previousAssignees:[],updates:[],notes:[],events:[{at:RECENT,by:'cs_east',action:'register'}]};
let serial=0;
const row=data=>{serial++;const merged={...base,...data};return {id:'complaint-'+serial,branch:'Main',assignedTo:merged.registrarId,data:merged,createdAt:merged.submittedAt,updatedAt:merged.closedAt||merged.submittedAt,version:3};};
const rows=[
 row({submittedAt:LATE,complaintNumber:124,contactWhatsapp:'0551234567',contactEmail:'khaled@example.com'}),         // 1: late review, numbered, with WhatsApp and e-mail
 row({customerId:'c-2',severity:'high',contactWhatsapp:'0112345678'}),                                               // 2: high, western, a landline in the WhatsApp box
 row({status:'returned',submittedAt:OLD,returnedAt:RECENT,returnNote:'Add the invoice number'}),                     // 3
 row({status:'pending_assignment',submittedAt:OLD,forwardedAt:RECENT,salesManagerId:'sm'}),                        // 4
 row({status:'assigned',submittedAt:OLD,forwardedAt:OLD,assignedAt:LATE,salesManagerId:'sm',assigneeId:'rep',assignmentNote:'Important customer',events:[{at:OLD,by:'cs_east',action:'register'},{at:OLD,by:'csm',action:'forward',targetId:'sm'},{at:LATE,by:'sm',action:'assign',targetId:'rep',text:'Important customer'}]}), // 5
 row({status:'assigned',submittedAt:OLD,forwardedAt:OLD,assignedAt:OLD,salesManagerId:'sm',assigneeId:'rep',updates:[{id:'u1',at:LATE,by:'rep',channel:'visit',date:'2026-10-13',text:'Visited the factory and checked the mold'}],notes:[{id:'n1',at:LATE,by:'csm',text:'The customer called twice'}]}), // 6
 row({status:'resolved',submittedAt:OLD,forwardedAt:OLD,assignedAt:OLD,salesManagerId:'sm',assigneeId:'rep',updates:[{id:'u2',at:OLD,by:'rep',channel:'call',date:'2026-10-08',text:'Called the customer'}],resolvedAt:RECENT,resolution:{outcome:'solved',note:'Replaced the mold',by:'rep',at:RECENT},contactWhatsapp:'0551234567',notifiedAt:RECENT,notifiedBy:'cs_east'}), // 7: the customer was told
 row({status:'closed',submittedAt:OLD,forwardedAt:OLD,assignedAt:OLD,salesManagerId:'sm',assigneeId:'rep',resolvedAt:LATE,resolution:{outcome:'solved',note:'Replaced the mold',by:'rep',at:LATE},closedAt:RECENT,closure:{outcome:'satisfied',note:'Customer confirmed',by:'cs_east',at:RECENT}}) // 8
];
const list=me=>C.complaintQueue({me:members.find(member=>member.id===me),members,all:customers,complaints:rows},now,Infinity);
const data=me=>{const complaints=list(me);return {generatedAt:now,complaints,counts:{complaints:complaints.length,open:complaints.filter(entry=>C.isOpenComplaint(entry)).length,badge:C.complaintBadge(complaints)}};};
const me=id=>members.find(member=>member.id===id);
const page=(id,mode='page')=>html(React.createElement(ComplaintsList,{data:data(id),me:me(id),mode,onOpen:noop}));

// ---- the page and the panel, per role
let out=page('csm');
eq([count(out,'class="complaint-card"'),count(out,'data-group="act"'),count(out,'data-group="open"'),count(out,'data-group="finished"')],[8,1,1,1],'the manager\'s page: every complaint in the three sections');
ok(out.includes('بانتظار إجرائك')&&out.includes('شكاوى مفتوحة')&&out.includes('مغلقة وملغاة خلال 30 يومًا'),'with the section titles');
ok(out.includes('مراجعة الشكوى'),'the review button on what waits for him');
ok(out.includes('data-late="true"')&&out.includes('متأخر عن هدف 4 ساعة عمل'),'the late one is marked against its target');
ok(out.includes('data-severity="high"')&&out.includes('أهمية عالية'),'the high one is marked');
ok(out.includes('بانتظار مراجعة مدير خدمة العملاء')&&out.includes('مطلوب تعديل')&&out.includes('بانتظار تكليف المبيعات')&&out.includes('بانتظار أول تواصل من المندوب')&&out.includes('قيد الحل مع المندوب')&&out.includes('بانتظار تأكيد الإغلاق')&&out.includes('مغلقة'),'each card says where it stands');
ok(out.includes('العميل راضٍ'),'and the closed one its closure outcome');
out=page('cs_east');
eq([count(out,'class="complaint-card"'),count(out,'data-group="act"')],[7,1],'the registrar sees the eastern ones; what waits for her first');
ok(out.includes('تعديل وإعادة الإرسال')&&out.includes('تأكيد الإغلاق'),'asked to correct one and to close one');
ok(!out.includes('Factory Two'),'and not the western customer');
out=page('cs_west');
eq(count(out,'class="complaint-card"'),1,'the west sees only its own');
out=page('sm','panel');
eq([count(out,'class="complaint-card"'),count(out,'complaints-panel')],[5,1],'the sales manager\'s panel on the Visits page: what came to him and what his people hold');
ok(out.includes('تكليف مندوب'),'asked to assign');
out=page('rep','panel');
eq(count(out,'class="complaint-card"'),4,'the representative\'s panel: what he holds, resolved and closed');
ok(out.includes('تسجيل التواصل')&&out.includes('تسجيل الحل'),'asked to contact on one and to resolve the other');
eq(html(React.createElement(ComplaintsList,{data:{generatedAt:now,complaints:[],counts:{complaints:0,open:0,badge:0}},me:me('rep2'),mode:'panel',onOpen:noop})),'','a sales member with nothing sees no panel');
ok(html(React.createElement(ComplaintsList,{data:{generatedAt:now,complaints:[],counts:{complaints:0,open:0,badge:0}},me:me('cs_west'),mode:'page',onOpen:noop})).includes('لا شكاوى'),'the page says when there is nothing');
ok(html(React.createElement(ComplaintsList,{data:null,me:me('csm'),mode:'page',onOpen:noop})).includes('جارٍ تحميل الشكاوى'),'and while loading');
const cutData={...data('csm'),counts:{complaints:900,open:600,badge:2}};
ok(html(React.createElement(ComplaintsList,{data:cutData,me:me('csm'),mode:'page',onOpen:noop})).includes('تُعرض 8 من أصل 900 شكوى'),'a cut list says how many of how many');

// ---- the registration form
out=html(React.createElement(ComplaintRegisterDialog,{me:me('cs_east'),records:customers,complaints:list('cs_east'),onClose:noop,onSaved:noop}));
ok(out.includes('تسجيل شكوى')&&out.includes('بحث عن العميل'),'the form opens on the customer search');
eq([out.includes('data-customer="c-1"'),out.includes('data-customer="c-2"')],[true,false],'offering the customers of the registrar\'s region only');
ok(!out.includes('وصف الشكوى'),'the report fields wait for a customer');
out=html(React.createElement(ComplaintRegisterDialog,{me:me('owner'),records:customers,complaints:[],onClose:noop,onSaved:noop}));
eq([out.includes('data-customer="c-1"'),out.includes('data-customer="c-2"')],[true,true],'an administrator may pick any customer');
eq(html(React.createElement(ComplaintRegisterDialog,{me:me('rep'),records:customers,complaints:[],onClose:noop,onSaved:noop})).includes('data-customer='),false,'a representative is offered nobody');

// ---- the sheet: what each reader is offered
const entryOf=(id,who)=>list(who).find(entry=>entry.id===id);
const sheet=(id,who)=>html(React.createElement(ComplaintSheet,{entry:entryOf(id,who),onClose:noop,onChanged:async()=>{}}));
out=sheet('complaint-1','csm');
ok(out.includes('إحالة إلى مدير المبيعات')&&out.includes('Sales Manager')&&out.includes('إعادة للتعديل: ما الذي يلزم؟'),'the manager may forward it to his sales manager or return it');
ok(!out.includes('تسجيل الحل')&&!out.includes('تأكيد الإغلاق'),'and nothing else');
ok(out.includes('The mold produces a broken block')&&out.includes('Replace the mold')&&out.includes('INV-100')&&out.includes('Abu Khalid')&&out.includes('tel:0551234567'),'the report is shown whole, with a dial link');
out=sheet('complaint-1','cs_east');
ok(out.includes('تعديل الشكوى')&&out.includes('إلغاء الشكوى')&&!out.includes('إحالة إلى مدير المبيعات'),'the registrar may correct or cancel, not forward');
out=sheet('complaint-3','cs_east');
ok(out.includes('سبب الإعادة للتعديل')&&out.includes('Add the invoice number'),'a returned one shows why');
out=sheet('complaint-4','sm');
ok(out.includes('تكليف مندوب أو مشرف')&&out.includes('Rep One · ')&&out.includes('المندوب الحالي للعميل')&&out.includes('ملاحظة للمكلَّف'),'the sales manager assigns, the customer\'s representative marked');
out=sheet('complaint-5','rep');
ok(out.includes('تسجيل تواصل مع العميل')&&out.includes('تسجيل الحل')&&out.includes('Important customer')&&!out.includes('تكليف مندوب أو مشرف')&&!out.includes('إحالة إلى مدير المبيعات'),'the representative records contacts and the resolution, and hands it to nobody');
ok(out.includes('سير الشكوى')&&out.includes('تسجيل شكوى')&&out.includes('إحالة الشكوى إلى مدير المبيعات · Sales Manager')&&out.includes('تكليف المبيعات بالشكوى · Rep One'),'with the complaint\'s story');
out=sheet('complaint-5','sup');
{const select=out.match(/<select[^]*?<\/select>/)?.[0]||'';ok(out.includes('تفويض مندوب من فريقك')&&select.includes('Rep Two')&&!select.includes('Rep One'),'the supervisor may delegate to another of his representatives, never to the one holding it');}
out=sheet('complaint-6','rep');
ok(out.includes('Visited the factory and checked the mold')&&out.includes('تواصل مع العميل · زيارة')&&out.includes('The customer called twice')&&out.includes('ملاحظة داخلية'),'updates and notes appear in the story');
out=sheet('complaint-7','cs_east');
ok(out.includes('تأكيد الإغلاق مع العميل')&&out.includes('إغلاق الشكوى')&&out.includes('أو إعادتها إلى المندوب')&&out.includes('حُلّت · Replaced the mold'),'the registrar closes or returns a resolved one, seeing the resolution');
out=sheet('complaint-7','rep');
ok(!out.includes('إغلاق الشكوى')&&out.includes('ملاحظة داخلية'),'the representative may only note on it');
out=sheet('complaint-8','cs_east');
ok(out.includes('إعادة فتح الشكوى: لماذا؟')&&out.includes('العميل راضٍ · Customer confirmed'),'a closed one may be reopened, and shows its closure');
ok(!sheet('complaint-8','rep').includes('إعادة فتح'),'not by the representative');

// ---- the number, the contact details and the message to the customer
const MESSAGE='شركة يورست للصناعات ترحب بكم : تم تسجيل شكوى برقم 124 بتاريخ 13/10/2026 بخصوص «جودة المنتج أو القالب»، وسيتم التواصل معكم للمتابعة حتى الحل. نشكر لكم ثقتكم.\n\nYourrest Industries welcomes you: a complaint has been registered under number 124 on 13/10/2026 regarding “Product or mold quality”, and we will contact you to follow up until it is resolved. We thank you for your trust.';
const hrefsOf=source=>[...source.matchAll(/data-notify="open" href="([^"]+)"/g)].map(match=>match[1].replace(/&amp;/g,'&'));
out=page('cs_east');
ok(out.includes('<bdi class="complaint-number">#124 </bdi>'),'the numbered complaint shows its number on its card');
eq(hrefsOf(out).map(href=>href.split('?')[0]),['https://wa.me/966551234567'],'the registrar has the message button on the card of the open complaint whose customer was not told and whose number WhatsApp can open (the one already told and the ones with no number have none)');
eq(decodeURIComponent(hrefsOf(out)[0].split('?text=')[1]),MESSAGE,'and it carries the complaint\'s own number, date and category, in Arabic and in English, word for word');
ok(out.includes('data-notified="true"')&&out.includes('فُتحت رسالة واتساب للعميل'),'the complaint whose customer was told says so on its card');
out=page('csm');
eq(hrefsOf(out).length,1,'the manager has the same button, and not for the landline');
out=page('sm','panel');
eq(hrefsOf(out),[],'the sales manager\'s panel never offers it');
out=page('rep','panel');
eq(hrefsOf(out),[],'nor the representative\'s');
out=sheet('complaint-1','csm');
ok(out.includes('رقم 124'),'the sheet\'s title carries the number');
ok(out.includes('href="https://wa.me/966551234567"')&&out.includes('href="mailto:khaled@example.com"')&&out.includes('khaled@example.com'),'the sheet links the customer\'s WhatsApp chat and e-mail');
eq(hrefsOf(out).length,1,'with the message button, once');
ok(out.includes('تُفتح الرسالة في واتساب لتراجعها وترسلها من هاتفك'),'and says what it does');
out=sheet('complaint-2','csm');
ok(out.includes('لا رقم واتساب صالح للعميل في هذه الشكوى')&&hrefsOf(out).length===0&&!/wa\.me\/(966)?112345678/.test(out),'a number WhatsApp cannot open gets no button and no link, and the sheet says why');
out=sheet('complaint-7','cs_east');
ok(out.includes('إبلاغ العميل')&&out.includes('فُتحت رسالة واتساب للعميل')&&out.includes('CS East'),'once told, the sheet says by whom');
eq(hrefsOf(out),[],'and offers the button no more');
out=sheet('complaint-6','rep');
ok(!out.includes('إرسال رسالة واتساب للعميل')&&hrefsOf(out).length===0,'a representative is never offered it');
out=sheet('complaint-5','csm');
ok(!/شكوى عميل · رقم/.test(out),'a complaint from before numbering has no number in its title');

// ---- the customer's own list and the navigation count
out=html(React.createElement(CustomerComplaints,{entries:C.complaintsOfCustomer(list('owner'),'c-1'),onOpen:noop}));
eq(count(out,'class="complaint-card"'),7,'a customer\'s sheet lists his complaints');
ok(html(React.createElement(CustomerComplaints,{entries:[],onOpen:noop})).includes('لا شكاوى لهذا العميل'),'or says there are none');
out=html(React.createElement(MobileNavigation,{me:me('cs_east'),view:'activity',onNavigate:noop,accountOpen:false,onAccountOpenChange:noop,complaints:3}));
ok(out.includes('data-page="complaints"')&&/data-page="complaints"[^]*?nav-badge[^>]*>3</.test(out),'customer service has the complaints tab with its count');
out=html(React.createElement(MobileNavigation,{me:me('rep'),view:'activity',onNavigate:noop,accountOpen:false,onAccountOpenChange:noop,extra:2}));
ok(!out.includes('data-page="complaints"')&&/data-page="activity"[^]*?nav-badge[^>]*>2</.test(out),'a representative has no complaints tab; the count sits on Visits');

// ---- English, with no Arabic left behind
language='en';
out=page('csm');
ok(out.includes('Customer complaints')&&out.includes('Waiting for your action')&&out.includes('Review the complaint')&&out.includes('Late against a 4-working-hour target')&&out.includes('High')&&out.includes('Customer satisfied'),'the English page');
eq(arabicLeft(out),[],'with no Arabic');
out=sheet('complaint-5','rep');
ok(out.includes('Record a contact with the customer')&&out.includes('Record the resolution')&&/The complaint(&#x27;|')s story/.test(out)&&out.includes('Assigned to sales · Rep One'),'the English sheet');
eq(arabicLeft(out),[],'with no Arabic');
out=html(React.createElement(ComplaintRegisterDialog,{me:me('cs_east'),records:customers,complaints:[],onClose:noop,onSaved:noop}));
ok(out.includes('Register a complaint')&&out.includes('Search for the customer'),'the English form');
eq(arabicLeft(out),[],'with no Arabic');
out=sheet('complaint-1','csm');
ok(out.includes('Send a WhatsApp message to the customer')&&out.includes('No. 124')&&out.includes('E-mail'),'the English sheet offers the message and carries the number');
eq(arabicLeft(out),[],'with no Arabic');
out=page('cs_east');
ok(out.includes('Send a WhatsApp message to the customer')&&out.includes('WhatsApp message opened for the customer'),'the English card');
eq(arabicLeft(out),[],'with no Arabic');
language='ar';
ok(arabicLeft(page('csm')).length>20,'the Arabic control is Arabic');

console.log(JSON.stringify({ok:true,checks,coverage:'complaints page and panel per role, section titles, asks, late and high marks, loading and empty and cut states, registration form scope, sheet actions per reader and the story, customer list, navigation count, English without Arabic leftovers',realBrowser:false}));
