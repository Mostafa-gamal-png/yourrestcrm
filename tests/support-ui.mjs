// The customer-service assistance components rendered from the real source: the button beside a visit, the panel each role
// sees, the request form and the request sheet, in Arabic and in English. Render contracts only: no browser, no network,
// no production data. (Clicks, requests and refreshes are exercised in tests/support-browser.mjs.)
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
 },console,Date,Intl,crypto,URL,Promise,setTimeout,clearTimeout});
 return exports;
}
const S=library('lib/support.ts');
const {SupportButton,SupportPanel,SupportRequestDialog,SupportSheet}=load('app/support-panel.tsx');
const VisitsTable=load('app/visits-table.tsx').default;
const {CustomerFollowupsPage}=load('app/customer-followup-list.tsx');
const {QueueBadge}=load('app/service-queue.tsx');
const html=element=>renderToStaticMarkup(element);
const count=(source,part)=>source.split(part).length-1;
const arabicLeft=source=>(source.replace(/<[^>]+>/g,' ').match(/[؀-ۿ]+/g)||[]);
const noop=async()=>{};

const permissions=(o={})=>({take:false,assign:false,result:false,cancel:false,seen:false,...o});
const entry=(o={})=>({id:'support-1',customerId:'c-1',customerName:'مصنع الأمل',customerPhone:'0551234567',customerCity:'الدمام',customerRegion:'الشرقية',customerVersion:3,origin:'rep',state:'waiting',note:'العميل لا يرد على اتصالاتي',channel:'call',plan:null,requestedBy:'rep',requestedByName:'أحمد المندوب',repId:'rep',repName:'أحمد المندوب',handlerId:'',handlerName:'',result:null,answerSeen:false,cancelReason:'',cancelledByName:'',createdAt:'2026-10-14T05:00:00.000Z',updatedAt:'2026-10-14T05:00:00.000Z',version:1,stageHours:2,targetHours:4,late:false,unrouted:false,awaiting:null,permissions:permissions(),candidates:[],...o});
const missedEntry=(o={})=>({id:'missed-v-1',visitId:'v-1',customerId:'c-2',customerName:'مصنع النور',customerPhone:'0561234567',customerCity:'الخبر',customerRegion:'الشرقية',customerVersion:2,repId:'rep',repName:'أحمد المندوب',plan:{visitId:'v-1',visitDate:'2026-10-06',result:'سلبية',nextAction:'زيارة متابعة',nextDate:'2026-10-10'},overdueDays:4,missedSince:'2026-10-11T21:00:00.000Z',routedToId:'',routedToName:'',unrouted:false,permissions:{take:true},...o});
const data=(requests=[],missed=[])=>({generatedAt:'2026-10-14T09:00:00.000Z',requests,missed,counts:{requests:requests.length,missed:missed.length,badge:0}});
const me=(role,id=role)=>({id,role,name:id,email:id+'@x.org',branch:'الرئيسي',active:1,target:0});
const panel=(who,payload)=>html(React.createElement(SupportPanel,{data:payload,me:who,onOpen:()=>{},onChanged:noop}));

// ---- groups and the per-customer binding (pure)
{
 const waiting=entry({id:'a',state:'waiting',awaiting:'take',permissions:permissions({take:true})}),mine=entry({id:'b',state:'in_progress',handlerId:'cs',awaiting:'contact',permissions:permissions({result:true})}),theirs=entry({id:'c',state:'in_progress',handlerId:'other'});
 const done=entry({id:'d',state:'done',updatedAt:'2026-10-13T08:00:00.000Z',result:{outcome:'no_answer',note:'x',nextDate:'',by:'cs',byName:'cs',at:'2026-10-13T08:00:00.000Z'}}),old=entry({id:'e',state:'done',updatedAt:'2026-10-01T08:00:00.000Z'}),cancelled=entry({id:'f',state:'cancelled'});
 const m1=missedEntry({id:'m1',permissions:{take:true}}),m2=missedEntry({id:'m2',routedToId:'x',permissions:{take:false}});
 const names=groups=>groups.map(g=>g.id+':'+g.requests.map(r=>r.id).join('+')+'|'+g.missed.map(r=>r.id).join('+'));
 eq(names(S.supportGroups([waiting,mine,theirs,done,cancelled],[m1,m2],'customer_service')),['take:a|','mine:b|','missed:|m1','others:c|','missed_others:|m2','finished:d+f|'],'a customer-service representative: what to take, what they hold, the missed visits they may take, then the rest');
 const late=entry({id:'g',state:'waiting',late:true,awaiting:'assign'});
 eq(names(S.supportGroups([late,mine,theirs,done],[m1,m2],'customer_service_manager')),['decide:g|','mine:b|','others:c|','missed:|m1+m2','finished:d|'],'the manager: what needs a decision first, every missed visit');
 eq(names(S.supportGroups([late],[],'admin')),['decide:g|'],'empty sections are left out');
 const unseen=entry({id:'h',state:'done',awaiting:'answer',updatedAt:'2026-09-20T08:00:00.000Z',permissions:permissions({seen:true})});
 eq(names(S.supportGroups([waiting,theirs,done,old,unseen,cancelled],[],'rep','2026-10-14T09:00:00.000Z')),['waiting:a+c|','answered:h+d|','finished:e+f|'],'a sales member: what waits, the answers of the last week (unopened first, however old), the rest folded');
 eq(S.supportGroups([],[],'rep'),[],'nothing, no sections');
 const bound=S.supportByCustomer([entry({id:'x',customerId:'k',state:'done',updatedAt:'2026-10-13T08:00:00.000Z'}),entry({id:'y',customerId:'k',state:'waiting',updatedAt:'2026-10-14T01:00:00.000Z'}),entry({id:'z',customerId:'j',state:'done',updatedAt:'2026-09-01T08:00:00.000Z'}),entry({id:'w',customerId:'i',state:'cancelled'})],'2026-10-14T09:00:00.000Z');
 eq([Object.keys(bound).sort(),bound.k.id],[['k'],'y'],'an open request wins over an older answer; an old answer or a cancelled request is not shown beside the customer');
 eq(Object.keys(S.supportOutcomesEn),Object.keys(S.supportOutcomes),'every outcome has English wording');
 eq(Object.keys(S.supportChannelsEn),Object.keys(S.supportChannels),'and every channel');
}

// ---- the button
{
 const bind=(overrides={})=>({byCustomer:{},canRequest:()=>true,onRequest:()=>{},onOpen:()=>{},...overrides});
 eq(html(React.createElement(SupportButton,{customerId:'c-1'})),'','no binding, no button (customer service and the other pages)');
 eq(html(React.createElement(SupportButton,{customerId:'',support:bind()})),'','nor without a customer');
 let markup=html(React.createElement(SupportButton,{customerId:'c-1',support:bind()}));
 ok(markup.includes('طلب مساندة خدمة العملاء')&&markup.includes('support-request-button')&&markup.includes('data-customer="c-1"'),'a customer the member may ask about gets the request button');
 eq(html(React.createElement(SupportButton,{customerId:'c-1',support:bind({canRequest:()=>false})})),'','a customer they may not ask about gets nothing');
 markup=html(React.createElement(SupportButton,{customerId:'c-1',support:bind({byCustomer:{'c-1':entry({state:'waiting'})}})}));
 ok(markup.includes('بانتظار خدمة العملاء')&&markup.includes('data-state="waiting"')&&!markup.includes('support-request-button'),'an open request shows where it stands instead of a second request button');
 markup=html(React.createElement(SupportButton,{customerId:'c-1',support:bind({byCustomer:{'c-1':entry({state:'in_progress',handlerName:'ريم'})}})}));
 ok(markup.includes('خدمة العملاء تتواصل')&&markup.includes('data-state="in_progress"'),'a request being worked on says so');
 markup=html(React.createElement(SupportButton,{customerId:'c-1',support:bind({byCustomer:{'c-1':entry({state:'done',permissions:permissions({seen:true})})}})}));
 ok(markup.includes('ردّت خدمة العملاء')&&markup.includes('data-unseen="true"'),'an unopened answer is marked');
 markup=html(React.createElement(SupportButton,{customerId:'c-1',support:bind({byCustomer:{'c-1':entry({state:'done'})}})}));
 ok(markup.includes('data-unseen="false"'),'an opened one is not');
 language='en';
 markup=html(React.createElement(SupportButton,{customerId:'c-1',support:bind()}));ok(markup.includes('Ask customer service for help')&&arabicLeft(markup).length===0,'English button');
 markup=html(React.createElement(SupportButton,{customerId:'c-1',support:bind({byCustomer:{'c-1':entry({state:'done'})}})}));ok(markup.includes('Customer service replied')&&arabicLeft(markup).length===0,'English answer chip');
 language='ar';
}

// ---- beside the visits: the latest visit of each customer listed
{
 const visit=(id,customerId,date)=>({id,kind:'activity',parentId:customerId,assignedTo:'rep',branch:'الرئيسي',data:{type:'visit',date,summary:'تعريف بمنتجات الشركة',result:'سلبية',salesStage:'new',nextAction:'زيارة',nextDate:'2026-10-20',visitNumber:7,performedBy:'rep',startedAt:date+'T07:00:00.000Z'},createdAt:date+'T07:00:00.000Z',updatedAt:date+'T07:00:00.000Z',version:1});
 const customers={'c-1':{id:'c-1',kind:'customer',data:{name:'مصنع الأمل'}},'c-2':{id:'c-2',kind:'customer',data:{name:'مصنع النور'}}};
 const rows=[visit('v-3','c-1','2026-10-12'),visit('v-2','c-2','2026-10-10'),visit('v-1','c-1','2026-10-01')];
 const binding={byCustomer:{},canRequest:id=>id!=='c-2',onRequest:()=>{},onOpen:()=>{}};
 const table=(support)=>html(React.createElement(VisitsTable,{rows,customerFor:row=>customers[row.parentId],onOpen:()=>{},onEdit:()=>{},support}));
 let markup=table(binding);
 eq(count(markup,'support-request-button'),2,'two buttons for three visits: one in each list (cards and table) beside the latest visit of the customer that may be asked about; none for the other customer, none beside the older visit');
 eq(count(table(undefined),'support-request-button'),0,'a table without the binding is unchanged');
 markup=table({...binding,canRequest:()=>true,byCustomer:{'c-1':entry({state:'waiting'}),'c-2':entry({customerId:'c-2',state:'done',permissions:permissions({seen:true})})}});
 eq([count(markup,'data-customer="c-1"'),count(markup,'data-customer="c-2"')],[2,2],'a request or an answer is shown beside the latest visit of its customer in both lists');
 language='en';
 ok(table({...binding,canRequest:()=>true}).includes('Ask customer service for help'),'English table button');
 language='ar';
 // follow-up plans: one per customer
 const plans=[{id:'a',kind:'customer',parentId:null,assignedTo:'rep',branch:'الرئيسي',data:{name:'مصنع الأمل',phone:'05'},createdAt:'2026-08-01T05:00:00.000Z',updatedAt:'2026-08-01T05:00:00.000Z',version:1},visit('v-9','a','2026-10-02')];
 const page=support=>html(React.createElement(CustomerFollowupsPage,{records:plans,members:[],query:'',staff:'all',stage:'all',onNew:()=>{},onOpen:()=>{},onCustomer:()=>{},support}));
 ok(count(page({byCustomer:{},canRequest:()=>true,onRequest:()=>{},onOpen:()=>{}}),'support-request-button')>=1,'the follow-up list offers the button beside an open plan');
 eq(count(page(undefined),'support-request-button'),0,'and not without the binding');
}

// ---- the panel, role by role
{
 const waiting=entry({id:'a',state:'waiting',awaiting:'take',late:true,stageHours:6,permissions:permissions({take:true})});
 const held=entry({id:'b',customerName:'مصنع القمة',state:'in_progress',handlerId:'cs',handlerName:'ريم',awaiting:'contact',permissions:permissions({result:true})});
 const fromMissed=entry({id:'c',customerName:'مصنع الريادة',origin:'missed_visit',note:'',plan:{visitId:'v-9',visitDate:'2026-10-01',result:'سلبية',nextAction:'زيارة متابعة',nextDate:'2026-10-05'},state:'in_progress',handlerId:'cs',handlerName:'ريم',awaiting:'contact',permissions:permissions({result:true})});
 const answered=entry({id:'d',state:'done',awaiting:'answer',updatedAt:'2026-10-13T08:00:00.000Z',handlerName:'ريم',result:{outcome:'wants_visit',note:'يريد زيارة يوم الأحد',nextDate:'2026-10-18',by:'cs',byName:'ريم',at:'2026-10-13T08:00:00.000Z'},permissions:permissions({seen:true})});
 const missed=[missedEntry(),missedEntry({id:'missed-v-2',visitId:'v-2',customerId:'c-3',customerName:'مصنع الجبل',routedToId:'east',routedToName:'ريم',permissions:{take:false}})];
 eq(panel(me('customer_service'),null),'','nothing before the data arrives');
 eq(panel(me('customer_service'),data()),'','nothing to show, no panel');
 let markup=panel(me('customer_service'),data([waiting,held,fromMissed],missed));
 eq([...markup.matchAll(/data-group="(\w+)"/g)].map(m=>m[1]),['take','mine','missed','missed_others'],'customer service: to take, held, missed visits, those routed to a colleague');
 ok(markup.includes('data-role="customer_service"')&&markup.includes('التواصل مع العملاء')&&markup.includes('بانتظار تولّيك')&&markup.includes('قيد تواصلك')&&markup.includes('زيارات مفقودة في منطقتك'),'headings and titles');
 eq(count(markup,'data-request="'),3,'one card per request');
 ok(markup.includes('data-late="true"')&&markup.includes('متأخر عن هدف 4 ساعات عمل'),'the late card says against which target');
 ok(markup.includes('href="tel:0551234567"')&&markup.includes('href="https://wa.me/966551234567"'),'a phone and a WhatsApp link for the customer');
 ok(markup.includes('متأخرة 4 يومًا')&&markup.includes('زيارة متابعة · 2026-10-10')&&markup.includes('مسندة إلى ريم'),'a missed visit: how far behind, its plan, who it is routed to');
 eq([count(markup,'تولّي التواصل'),count(markup,'مسندة لممثل آخر')],[2,1],'take buttons for what may be taken; a note on what is routed to someone else');
 ok(markup.includes('تسجيل النتيجة')&&markup.includes('support-folded'),'the held request offers the result; the colleague\'s are folded');
 ok(!/PRIVATE/.test(markup),'nothing private');
 markup=panel(me('customer_service_manager'),data([entry({id:'a',state:'waiting',late:true,awaiting:'assign',unrouted:true,permissions:permissions({take:true,assign:true,result:true})}),held],missed));
 eq([...markup.matchAll(/data-group="(\w+)"/g)].map(m=>m[1]),['decide','mine','missed'],'the manager: what needs a decision, what is his, every missed visit');
 ok(markup.includes('تحتاج قرارك')&&markup.includes('لا أحد يغطي منطقة العميل'),'the decision section and the unrouted flag');
 markup=panel(me('rep'),data([entry({id:'a',state:'waiting'}),answered,entry({id:'x',state:'cancelled'})]));
 eq([...markup.matchAll(/data-group="(\w+)"/g)].map(m=>m[1]),['waiting','answered','finished'],'a representative: what waits, the answers, the rest folded');
 ok(markup.includes('data-role="rep"')&&markup.includes('مساندة خدمة العملاء')&&markup.includes('طلباتك لخدمة العملاء وردودها.')&&markup.includes('يريد زيارة يوم الأحد')&&markup.includes('موعد الزيارة المقترح')&&markup.includes('2026-10-18')&&markup.includes('عرض الرد'),'the answer is read from the card, with the date the customer asked for');
 ok(!markup.includes('تولّي التواصل')&&!markup.includes('tel:'),'a sales member has no take button and no dial links');
 ok(panel(me('supervisor'),data([entry({id:'a'})])).includes('طلبات فريقك لخدمة العملاء وردودها.'),'a supervisor reads their team\'s');
 // many missed visits are shown in part
 const many=Array.from({length:11},(_,n)=>missedEntry({id:'missed-m'+n,visitId:'m'+n,customerName:'مصنع '+n}));
 markup=panel(me('customer_service'),data([],many));
 eq([count(markup,'data-missed="'),count(markup,'عرض الباقي (3)')],[11,1],'eleven missed visits: eight at once, three behind "show the rest"');
 // English: nothing the components write is Arabic
 language='en';
 const latin=o=>entry({customerName:'Plant A',customerCity:'Dammam',customerRegion:'Eastern',requestedByName:'Agent',repName:'Agent',handlerName:'Holder',note:'Customer does not answer',...o});
 const englishRequests=[latin({id:'a',state:'waiting',awaiting:'take',late:true,stageHours:6,permissions:permissions({take:true})}),latin({id:'b',state:'in_progress',handlerId:'cs',awaiting:'contact',permissions:permissions({result:true})}),latin({id:'c',origin:'missed_visit',note:'',plan:{visitId:'v-9',visitDate:'2026-10-01',result:'سلبية',nextAction:'Technical visit',nextDate:'2026-10-05'},state:'in_progress',handlerId:'cs',awaiting:'contact'}),latin({id:'d',state:'done',awaiting:'answer',updatedAt:'2026-10-13T08:00:00.000Z',result:{outcome:'wants_visit',note:'Wants a visit',nextDate:'2026-10-18',by:'cs',byName:'Holder',at:'2026-10-13T08:00:00.000Z'}}),latin({id:'e',state:'cancelled',cancelReason:'Solved'}),latin({id:'f',state:'waiting',unrouted:true,awaiting:'assign',permissions:permissions({assign:true})})];
 const englishMissed=[missedEntry({customerName:'Plant B',customerCity:'Khobar',repName:'Agent',plan:{visitId:'v-1',visitDate:'2026-10-06',result:'سلبية',nextAction:'Follow-up visit',nextDate:'2026-10-10'}}),missedEntry({id:'missed-v-2',visitId:'v-2',customerName:'Plant C',customerCity:'Khobar',repName:'Agent',routedToId:'e',routedToName:'Holder',permissions:{take:false},unrouted:true,plan:{visitId:'v-2',visitDate:'2026-10-06',result:'سلبية',nextAction:'Follow-up visit',nextDate:'2026-10-10'}})];
 for(const who of ['customer_service','customer_service_manager','admin','rep','supervisor','manager'])eq(arabicLeft(panel(me(who),data(englishRequests,englishMissed))),[],'English panel for '+who+' has no untranslated wording');
 markup=panel(me('customer_service'),data(englishRequests,englishMissed));
 ok(markup.includes('Customer contact')&&markup.includes('Waiting for you to take')&&markup.includes('Missed visits in your region')&&markup.includes('Behind by 4 days')&&markup.includes('Late against a 4-working-hour target'),'English headings, chips and the late mark');
 ok(arabicLeft(panel(me('rep'),data(englishRequests))).length===0&&panel(me('rep'),data(englishRequests)).includes('Customer-service assistance'),'English representative panel');
 language='ar';
}

// ---- the request form and the request sheet
{
 const customer={id:'c-1',kind:'customer',version:3,data:{name:'مصنع الأمل'}};
 let markup=html(React.createElement(SupportRequestDialog,{customer,onClose:()=>{},onSaved:noop}));
 ok(markup.includes('طلب مساندة خدمة العملاء')&&markup.includes('مصنع الأمل')&&markup.includes('ما المطلوب من خدمة العملاء؟')&&markup.includes('إرسال الطلب')&&markup.includes('disabled=""'),'the form names the customer, asks what is wanted and keeps Send disabled until it is written');
 eq(count(markup,'<option'),3,'three ways to reach the customer');
 ok(markup.includes('أي وسيلة')&&markup.includes('اتصال')&&markup.includes('واتساب'),'in Arabic');
 language='en';markup=html(React.createElement(SupportRequestDialog,{customer:{...customer,data:{name:'Plant A'}},onClose:()=>{},onSaved:noop}));
 ok(markup.includes('Send the request')&&markup.includes('Any way')&&markup.includes('Phone call')&&markup.includes('WhatsApp')&&arabicLeft(markup).length===0,'and in English');language='ar';
 const sheet=(o,onChanged=noop)=>html(React.createElement(SupportSheet,{entry:entry(o),onClose:()=>{},onChanged}));
 markup=sheet({permissions:permissions({take:true})});
 ok(markup.includes('مصنع الأمل')&&markup.includes('0551234567')&&markup.includes('العميل لا يرد على اتصالاتي')&&markup.includes('لم يتولّه أحد بعد')&&markup.includes('تولّي التواصل'),'a waiting request: the facts and the take button');
 ok(!markup.includes('تسجيل النتيجة')&&!markup.includes('إلغاء الطلب'),'and nothing it may not do');
 markup=sheet({state:'in_progress',handlerName:'ريم',permissions:permissions({result:true}),late:true,stageHours:6});
 eq(count(markup,'<option'),7,'the result form: a prompt and the six outcomes');
 ok(markup.includes('نتيجة التواصل')&&markup.includes('تم التواصل والعميل مهتم')&&markup.includes('العميل يطلب زيارة في موعد')&&markup.includes('لم يرد العميل')&&markup.includes('تسجيل النتيجة')&&markup.includes('متأخر'),'outcomes in Arabic, and the late mark');
 markup=sheet({state:'in_progress',permissions:permissions({assign:true,result:true}),candidates:[{id:'cs_all',name:'سارة',role:'customer_service'},{id:'csm',name:'منى',role:'customer_service_manager'}]});
 ok(markup.includes('تكليف ممثل لخدمة العملاء')&&markup.includes('سارة')&&markup.includes('منى')&&markup.includes('تأكيد التكليف'),'the manager may assign to the region\'s members');
 markup=sheet({permissions:permissions({cancel:true})});
 ok(markup.includes('إلغاء الطلب (اختياري: السبب)'),'the asker may cancel');
 markup=sheet({state:'done',result:{outcome:'wants_visit',note:'يريد زيارة يوم الأحد',nextDate:'2026-10-18',by:'cs',byName:'ريم',at:'2026-10-13T08:00:00.000Z'},permissions:permissions({seen:true}),handlerName:'ريم'});
 ok(markup.includes('العميل يطلب زيارة في موعد')&&markup.includes('يريد زيارة يوم الأحد')&&markup.includes('2026-10-18')&&markup.includes('ريم'),'an answer: outcome, text, date and who recorded it');
 markup=sheet({state:'cancelled',cancelReason:'تم الحل'});ok(markup.includes('تم الحل')&&markup.includes('أُلغي'),'a cancelled request keeps its reason');
 markup=sheet({origin:'missed_visit',note:'',plan:{visitId:'v',visitDate:'2026-10-01',result:'سلبية',nextAction:'زيارة متابعة',nextDate:'2026-10-05'},state:'in_progress',requestedByName:'ريم'});
 ok(markup.includes('الزيارة المخطط لها')&&markup.includes('زيارة متابعة · 2026-10-05')&&markup.includes('فتحها'),'a missed visit: the plan that was not carried out');
 language='en';
 const latin={customerName:'Plant A',customerCity:'Dammam',customerRegion:'Eastern',requestedByName:'Agent',repName:'Agent',handlerName:'Holder',note:'Customer does not answer'};
 for(const o of [{permissions:permissions({take:true})},{state:'in_progress',permissions:permissions({assign:true,result:true,cancel:true}),candidates:[{id:'a',name:'Sara',role:'customer_service'}],late:true},{state:'done',result:{outcome:'no_answer',note:'No reply',nextDate:'',by:'cs',byName:'Holder',at:'2026-10-13T08:00:00.000Z'},permissions:permissions({seen:true})},{state:'cancelled',cancelReason:'Solved'},{origin:'missed_visit',note:'',plan:{visitId:'v',visitDate:'2026-10-01',result:'سلبية',nextAction:'Visit',nextDate:'2026-10-05'}}])eq(arabicLeft(sheet({...latin,...o})),[],'English sheet has no untranslated wording');
 ok(sheet({...latin,state:'in_progress',permissions:permissions({result:true})}).includes('Customer did not answer'),'English outcomes');
 language='ar';
}

// ---- the navigation badge carries both counts
{
 const waiting={awaiting:'assign',escalated:false,stage:'assignment'};
 eq(QueueBadge({entries:[],extra:0}),null,'no badge when neither has anything');
 eq(QueueBadge({entries:[],extra:3}).props.children,3,'assistance alone is counted');
 eq(QueueBadge({entries:[waiting],extra:2}).props.children,3,'and added to the customer-service requests');
 eq(QueueBadge({entries:[waiting]}).props.children,1,'the old call is unchanged');
}

console.log(JSON.stringify({ok:true,checks,render:'source components, Arabic and English',physicalDevice:false,productionDataUsed:false}));
