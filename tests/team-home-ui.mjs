// The top of the first screen (app/team-home.tsx, app/inactive-customers.tsx, app/team-today.tsx), rendered for real (server-side React,
// the components compiled as written, the language switched): who sees which card (a representative their own «عملاء واقفين» only;
// a supervisor the team's card and «فريقي اليوم»; customer service nothing; a hidden «العملاء» or «تقرير يوم المندوب» hides its
// card; no card at zero); the badge's words; the team card's order and «عرض الكل»; «فريقي اليوم» with its totals, «لم يبدأ بعد», the
// start and its source, the unread notes, a day off, before 6 AM, a failure, nobody, loading; Arabic and English with no Arabic left in
// the English words. Synthetic people only; no browser, no network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const root=process.cwd(),nativeRequire=createRequire(import.meta.url),cache=new Map();
const compiler={module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true};
let checks=0,language='ar';
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};
const dictionary=JSON.parse(fs.readFileSync('lib/locales/en.json','utf8'));
const i18n={useLanguage:()=>({language}),getLanguage:()=>language,direction:()=>language==='ar'?'rtl':'ltr',t:value=>language==='en'&&typeof value==='string'?(dictionary[value]||value):value};
const icons=new Proxy({},{get:(_,name)=>props=>React.createElement('svg',{'data-icon':String(name),className:props?.className})});
function load(filename){
 if(cache.has(filename))return cache.get(filename);
 const exports={},record={exports};cache.set(filename,exports);
 const require=name=>{
  if(name==='react')return React;if(name==='react/jsx-runtime')return jsx;if(name==='lucide-react')return icons;if(name.endsWith('.css'))return {};
  if(name==='@/lib/i18n')return i18n;
  const target=name.startsWith('@/')?name.slice(2):name.startsWith('.')?path.join(path.dirname(filename),name):null;
  if(!target)return nativeRequire(name);
  return load(fs.existsSync(path.join(root,target+'.ts'))?target+'.ts':target+'.tsx');
 };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,filename),'utf8'),{compilerOptions:compiler}).outputText,{exports,module:record,require,console,Intl,Date,crypto:globalThis.crypto,structuredClone,setTimeout,clearTimeout});
 return exports;
}
const {default:TeamHome}=load('app/team-home.tsx'),{OwnInactiveCard,TeamInactiveCard,InactiveCustomersBadge}=load('app/inactive-customers.tsx'),{TeamTodayView,TeamTodayLink}=load('app/team-today.tsx');
const render=element=>renderToStaticMarkup(element);
const noArabic=(html,message)=>ok(!/[؀-ۿ]/.test(html.replace(/<[^>]*>/g,' ')),message+': no Arabic left');
const noop=()=>{};

// ---- who sees what (TeamHome)
const access=(input={})=>({version:1,off:[],hidden:[],viewAll:false,...input});
const person=(id,role,extra={})=>({id,role,name:'اسم '+id,email:id+'@yourrest.org',branch:'الرئيسي',supervisorId:role==='rep'?'sup':'',regionScope:'all',active:1,target:0,access:access(),...extra});
const members=[person('sup','supervisor'),person('rep1','rep'),person('rep2','rep'),person('cs','customer_service')];
const stalled=(id,assignedTo)=>({id,kind:'customer',parentId:null,assignedTo,branch:'الرئيسي',data:{name:id,customerStatus:'نشط'},createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z',version:1});
const customers=[stalled('a','rep1'),stalled('b','rep1'),stalled('c','rep2')];
const home=(me,ownInactive=0,list=customers)=>render(React.createElement(TeamHome,{me,members,customers:list,ownInactive,offline:false,onCustomers:noop,onDayReport:noop}));
let html=home(person('rep1','rep'),2);
ok(html.includes('data-inactive-card="own"')&&!html.includes('data-inactive-card="team"')&&!html.includes('data-team-today'),'a representative: their own card only (no team card, no «فريقي اليوم»)');
ok(html.includes('عملاؤك الذين لم يشتروا منذ 60 يومًا: <b data-inactive-count="true">2</b>'),'with their count');
eq(home(person('rep1','rep'),0),'','a representative with none: nothing');
eq(home(person('rep1','rep',{access:access({hidden:['customer']})}),2),'','a representative whose «العملاء» is hidden: nothing');
html=home(person('sup','supervisor'));
ok(html.includes('data-inactive-card="team"')&&html.includes('data-team-today')&&!html.includes('data-inactive-card="own"'),'a supervisor: the team card and «فريقي اليوم»');
ok(html.includes('عملاء واقفين في فريقك: <b data-inactive-count="true">3</b>'),'the team total');
ok(html.includes('جارٍ تحميل ملخص الفريق…'),'«فريقي اليوم» starts by loading');
html=home(person('sup','supervisor',{access:access({hidden:['journeys']})}));
ok(html.includes('data-inactive-card="team"')&&!html.includes('data-team-today'),'«تقرير يوم المندوب» hidden: no «فريقي اليوم»');
html=home(person('sup','supervisor',{access:access({hidden:['customer']})}));
ok(!html.includes('data-inactive-card')&&html.includes('data-team-today'),'«العملاء» hidden: no stalled-customers card');
html=home(person('sup','supervisor'),0,[]);
ok(!html.includes('data-inactive-card')&&html.includes('data-team-today'),'nothing stalled: no card');
for(const role of ['customer_service','customer_service_manager'])eq(home(person('cs',role)),'',role+': nothing');
ok(home(person('mgr','manager')).includes('data-team-today')&&home(person('owner','admin')).includes('data-team-today'),'a sales manager and the administrator have «فريقي اليوم»');

// ---- the cards and the badge, both languages
const badge=count=>render(React.createElement(InactiveCustomersBadge,{count}));
eq(badge(0),'','no badge at zero');
eq(badge(4),'<span class="nav-badge inactive-customers-badge" role="img" data-inactive-badge="true" aria-label="4 من عملائك لم يشتروا منذ 60 يومًا">4</span>','the badge and its words');
const team={total:14,rows:Array.from({length:10},(_,i)=>({memberId:'m'+i,name:'Member '+i,role:'rep',active:i!==3,count:i===0?5:1}))};
html=render(React.createElement(TeamInactiveCard,{data:team,onOpen:noop}));
eq((html.match(/data-inactive-member=/g)||[]).length,8,'eight members shown at first');
ok(html.includes('عرض الكل (10)')&&html.includes('aria-expanded="false"'),'«عرض الكل» for the rest');
ok(html.indexOf('data-inactive-member="m0"')<html.indexOf('data-inactive-member="m1"'),'in the order given (most first)');
ok(html.includes('Member 3<small>معطّل</small>'),'an inactive member is marked');
eq(render(React.createElement(TeamInactiveCard,{data:{total:0,rows:[]},onOpen:noop})),'','no team card at zero');
language='en';
eq(badge(4).includes('aria-label="4 of your customers have not bought in 60 days"'),true,'English badge words');
html=render(React.createElement(OwnInactiveCard,{count:2,onOpen:noop}));
ok(html.includes('Your customers with no purchase in 60 days: <b data-inactive-count="true">2</b>')&&html.includes('Show them'),'English own card');noArabic(html,'English own card');
html=render(React.createElement(TeamInactiveCard,{data:team,onOpen:noop}));
ok(html.includes('Stalled customers in your team: <b data-inactive-count="true">14</b>')&&html.includes('Show all (10)')&&html.includes('Member 3<small>inactive</small>'),'English team card');noArabic(html,'English team card');
language='ar';

// ---- «فريقي اليوم»
const view=(data,extra={})=>render(React.createElement(TeamTodayView,{data,error:'',loading:false,offline:false,onRefresh:noop,onDayReport:noop,...extra}));
const row=(memberId,name,role,visits,contacts,startedAt,startedBy,unreadNotes)=>({memberId,name,role,visits,contacts,startedAt,startedBy,unreadNotes});
const data={ok:true,date:'2026-11-10',serverTime:'2026-11-10T09:00:00.000Z',workingDay:true,windowStartsAt:'2026-11-10T03:00:00.000Z',
 rows:[row('rep2','Rep Two','rep',0,0,null,null,2),row('rep1','Rep One','rep',2,1,'2026-11-10T04:42:00.000Z','movement',1),row('sup','Sup','supervisor',1,0,'2026-11-10T06:05:00.000Z','record',0)],
 totals:{members:3,started:2,visits:3,contacts:1,unreadNotes:3}};
html=view(data);
ok(html.includes('بدأوا 2 من 3 · زيارات 3 · ملاحظات غير مقروءة 3'),'the header totals');
eq((html.match(/data-member="/g)||[]).length,3,'one row each');
ok(html.indexOf('data-member="rep2"')<html.indexOf('data-member="rep1"'),'in the server\'s order (not started first)');
ok(/data-member="rep2" data-started="no">.*?لم يبدأ بعد/.test(html),'«لم يبدأ بعد»');
const arabicClock=new Intl.DateTimeFormat('ar-SA',{timeZone:'Asia/Riyadh',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date('2026-11-10T04:42:00.000Z'));
ok(html.includes(`<b dir="ltr">${arabicClock}</b> · أول حركة`),'the start in Riyadh time and its source: '+arabicClock);
ok(html.includes('أول تسجيل'),'a start from a record');
ok(html.includes('<span class="team-today-unread">2</span>'),'the unread notes');
ok(html.includes('Sup<small>مشرف المبيعات</small>'),'a supervisor who visited is named by role');
eq((html.match(/data-team-today-report="/g)||[]).length,3,'«تقرير اليوم» on every row');
ok(html.includes('data-label="زيارات اليوم"')&&html.includes('بدأ يومه؟'),'the column words (also each cell\'s label on a phone)');
ok(!html.includes('team-today-note'),'a working day after 6 AM: no note');
ok(view({...data,workingDay:false}).includes('اليوم إجازة (الجمعة)'),'a day off');
ok(view({...data,serverTime:'2026-11-10T02:00:00.000Z'}).includes('تبدأ ساعات التتبع في السادسة صباحًا'),'before 6 AM');
ok(view({...data,rows:[],totals:{members:0,started:0,visits:0,contacts:0,unreadNotes:0}}).includes('لا يوجد مناديب في فريقك.'),'nobody in the team');
ok(view(null).includes('جارٍ تحميل ملخص الفريق…'),'loading');
ok(view(null,{error:'team-today:failed'}).includes('تعذر تحميل ملخص الفريق. حاول مرة أخرى.'),'a failure');
ok(view(null,{offline:true}).includes('يتطلب ملخص الفريق اتصالًا بالإنترنت.'),'offline');
ok(view(data,{loading:true}).includes('disabled=""'),'refreshing: the button waits');
ok(render(React.createElement(TeamTodayLink,{onOpen:noop})).includes('ملخص فريقي اليوم'),'the link from the day report');
language='en';
html=view(data);
ok(html.includes('Started 2 of 3 · Visits 3 · Unread notes 3')&&html.includes('Not started yet')&&html.includes('first movement')&&html.includes('first record')&&html.includes('Sup<small>Sales supervisor</small>'),'English');
const englishClock=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Riyadh',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date('2026-11-10T04:42:00.000Z'));
eq(englishClock,'07:42','Riyadh is UTC+3');ok(html.includes('<b dir="ltr">07:42</b>'),'the English start time');
noArabic(html,'English «فريقي اليوم»');
noArabic(view({...data,workingDay:false})+view({...data,serverTime:'2026-11-10T02:00:00.000Z'})+view(null)+view(null,{error:'team-today:failed'})+view(null,{offline:true})+render(React.createElement(TeamTodayLink,{onOpen:noop})),'English notes and link');

console.log(JSON.stringify({ok:true,checks,realBrowser:false,languages:['ar','en']}));
