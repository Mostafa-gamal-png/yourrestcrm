// «زيارات ومتابعات بلا نتيجة أو إجراء» (the owner, 2026-11-15, from GSCO: «عايز يبان للمشرف كارد لونه احمر بزيارات ومتابعات بلا نتيجة او اجراء
// فى عدد اللى لسه مخدش اجراء ولما يضغط عليه يروح ليهم»; lib/supervisor-reviews*.ts ReviewPending, GET /api/reviews/pending, app/review-pending.tsx).
// 1. The pure rules (the 7 days, the order, the 8 lines and «وأيام أخرى: N», who sees the card). 2. The route on an isolated in-memory SQLite
// with the clock fixed: each team's scope (a supervisor their own representatives, a sales manager theirs), the count equal to what the
// reader's own day report offers to note and has no note (GET /api/reviews `reviewable` less its notes, day by day), the window at 00:00
// Riyadh, a saved note taking its visit off at once, the representative, customer service and the administrator refused, a hidden screen,
// «إضافة» switched off, «عرض بيانات الفريق بالكامل» widening nothing. 3. The card as React draws it (Arabic and English, the lines, what
// a press opens) and the members of TeamHome who get it. Synthetic people only; no build, no network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'review-pending-')),seen=new Set();
process.on('exit',()=>{fs.rmSync(out,{recursive:true,force:true});});
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};
function compile(relative){if(seen.has(relative))return;seen.add(relative);const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';compile(source);return 'from '+JSON.stringify(path.join(out,source.replace(/\.tsx?$/,'.mjs')));});fs.writeFileSync(dest,code);}
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const u=globalThis.testUser;if(!u)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version FROM crm_members WHERE user_id=?').bind(u.userId).first();return {...u,provider:'email-otp',memberId:m?.id||'missing',memberVersion:m?.auth_version};}`);
for(const name of ['reviews','reviews/pending'])compile('app/api/'+name+'/route.ts');
const rules=await import(pathToFileURL(path.join(out,'lib/supervisor-reviews.mjs')));

// ---- 1. The pure rules.
eq([rules.REVIEW_PENDING_DAYS,rules.REVIEW_PENDING_SHOWN,[...rules.REVIEW_PENDING_ROLES]],[7,8,['supervisor','manager']],'7 days, 8 lines, a supervisor and a sales manager');
eq(['supervisor','manager','admin','rep','customer_service','customer_service_manager',''].map(rules.reviewPendingRole),[true,true,false,false,false,false,false],'the card: never the administrator, a representative or customer service');
eq(rules.reviewPendingDates('2026-11-15'),['2026-11-15','2026-11-14','2026-11-13','2026-11-12','2026-11-11','2026-11-10','2026-11-09'],'today and the six days before it, newest first');
eq(rules.reviewPendingDates('2026-03-03'),['2026-03-03','2026-03-02','2026-03-01','2026-02-28','2026-02-27','2026-02-26','2026-02-25'],'across the end of February');
eq(rules.reviewPendingDates('2028-03-01').at(-1),'2028-02-24','a leap year');
eq(rules.reviewPendingDates('2027-01-02').slice(1,4),['2027-01-01','2026-12-31','2026-12-30'],'across the year');
eq(rules.reviewPendingDates('not a day'),[],'nothing for a day that is not one');
const item=(memberId,date,pending,name='اسم '+memberId)=>({memberId,name,date,pending});
eq(rules.sortReviewPending([item('a','2026-11-13',1),item('b','2026-11-15',2),item('c','2026-11-15',5),item('d','2026-11-15',2,'أحمد')]).map(i=>i.memberId),['c','d','b','a'],'the newest day first; on a day the most waiting first, then by name');
const many=Array.from({length:11},(_,i)=>item('r'+i,'2026-11-1'+(i%7),i+1));
eq([rules.reviewPendingLines(many).lines.length,rules.reviewPendingLines(many).others],[8,3],'8 lines, then «وأيام أخرى: 3»');
eq(rules.reviewPendingLines(many.slice(0,8)).others,0,'exactly 8: nothing more');
eq(rules.reviewPendingLines([]),{lines:[],others:0},'none');
const valid={ok:true,days:7,total:3,items:[item('a','2026-11-15',2),item('b','2026-11-14',1)]};
ok(rules.validReviewPending(valid),'a well-formed answer');
for(const broken of [{...valid,total:4},{...valid,ok:false},{...valid,items:[item('a','2026/11/15',3)]},{...valid,items:[item('a','2026-11-15',0)],total:0},{...valid,items:[{...item('a','2026-11-15',3),name:5}]},{...valid,days:0},null,'x'])ok(!rules.validReviewPending(broken),'refused: '+JSON.stringify(broken).slice(0,80));
ok(rules.validReviewPending({ok:true,days:7,total:0,items:[]}),'nothing waiting is an answer too');

// ---- 2. The route, on the day report's own data, with the clock fixed (Riyadh 11:00 on 2026-11-15).
const NativeDate=Date;let clock=NativeDate.parse('2026-11-15T08:00:00.000Z');
globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
process.on('exit',()=>{globalThis.Date=NativeDate;});
const migrations=fs.readdirSync(path.join(root,'drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).sort();
eq([migrations.filter(name=>name<='0020_member_permissions.sql').length,migrations.filter(name=>name<='0020_member_permissions.sql').at(-1)],[21,'0020_member_permissions.sql'],'no new migration');
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const name of migrations)sql.exec(fs.readFileSync(path.join(root,'drizzle',name),'utf8'));
class Statement{constructor(q,a=[]){this.q=q;this.a=a;}bind(...a){return new Statement(this.q,a);}async run(){const r=sql.prepare(this.q).run(...this.a);return{meta:{changes:Number(r.changes)}};}async all(){return{results:sql.prepare(this.q).all(...this.a)};}async first(){return sql.prepare(this.q).get(...this.a)||null;}}
const DB={prepare:q=>new Statement(q),batch:async statements=>{sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(/^\s*(SELECT|WITH)/i.test(s.q)?{...await s.all(),meta:{changes:0}}:await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid'};
const stamp='2026-11-01T08:00:00.000Z';
const member=(id,role,supervisor=null,region='eastern',active=1)=>sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,?,0,?)').run(id,'u-'+id,id+'@yourrest.org','اسم '+id,role,'الرئيسي',supervisor,region,active,stamp);
member('owner','admin',null,'all');member('mgr','manager',null,'all');member('mgre','manager',null,'eastern');member('sup','supervisor','mgr');member('sup2','supervisor','mgr');
member('rep1','rep','sup');member('rep3','rep','sup');member('rep2','rep','sup2');member('repw','rep','sup','western');member('cs','customer_service','mgr');
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-owner')").run();
const record=(id,kind,parent,assigned,data,at=stamp)=>sql.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').run(id,kind,parent,assigned,'الرئيسي',JSON.stringify(data),at,at);
record('c1','customer',null,'rep1',{name:'مصنع الشرق',region:'الشرقية',city:'الدمام'});
record('c2','customer',null,'rep2',{name:'مصنع الخبر',region:'الشرقية',city:'الخبر'});
record('cw','customer',null,'repw',{name:'مصنع الغرب',region:'الغربية',city:'جدة'});
// An activity of the day report: dated by data.date, else by the Riyadh day of when it was stored (as GET /api/journeys reads it).
const activity=(id,by,customer,date,extra={},at=stamp)=>record(id,'activity',customer,by,{type:'visit',...(date?{date}:{}),summary:'تعريف',result:'نتيجة '+id,performedBy:by,responsibleId:by,recordedByEmail:by+'@yourrest.org',...extra},at);
activity('a15','rep1','c1','2026-11-15');activity('b15','rep1','c1','2026-11-15',{type:'call'});activity('f15','rep1','c1','2026-11-15',{type:'call',visitWorkflow:'followup-v1'});
activity('a14','rep1','c1','2026-11-14');activity('a09','rep1','c1','2026-11-09');activity('a08','rep1','c1','2026-11-08');
activity('r3','rep3','c1','2026-11-13');
activity('n2','rep2','c2','2026-11-15');activity('n2b','rep2','c2','2026-11-12',{type:'whatsapp'});
activity('w1','repw','cw','2026-11-15');
activity('s1','sup','c1','2026-11-15');activity('m1','mgr','c1','2026-11-15');
// The window's edge at 00:00 Riyadh, from when the record was stored (no data.date): the last second of 2026-11-08 and the first of 2026-11-09.
activity('edge-out','rep3','c1','',{},'2026-11-08T20:59:59.999Z');activity('edge-in','rep3','c1','',{},'2026-11-08T21:00:00.000Z');
// Something the card never counts: a customer (not an activity), a future day, a visit without its customer.
activity('future','rep1','c1','2026-11-16');record('orphan','activity','missing','rep1',{type:'visit',date:'2026-11-15',performedBy:'rep1'});
const user=id=>{globalThis.testUser=id?{userId:'u-'+id,email:id+'@yourrest.org',fullName:id}:null;};
const reviews=await import(pathToFileURL(path.join(out,'app/api/reviews/route.mjs'))),pendingRoute=await import(pathToFileURL(path.join(out,'app/api/reviews/pending/route.mjs')));
const call=async(handler,{as,body,url='https://test.invalid/api/x'},status=200)=>{
 user(as);const request=body===undefined?new Request(url):new Request(url,{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json'},body:JSON.stringify(body)});
 const response=await handler(request),data=await response.json();eq(response.status,status,(as||'anonymous')+' '+url+' -> '+JSON.stringify(data).slice(0,300));
 if(status===200)eq(response.headers.get('cache-control'),'no-store',url+': never cached');
 return data;
};
const pending=(as,status)=>call(pendingRoute.GET,{as,url:'https://test.invalid/api/reviews/pending'},status);
const lines=data=>data.items.map(i=>[i.memberId,i.date,i.pending]);
const hide=(id,hidden,extra={})=>sql.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_by,updated_at) VALUES(?,?,?,1,'owner',?) ON CONFLICT(member_id) DO UPDATE SET permissions=excluded.permissions,hidden=excluded.hidden,version=version+1").run(id,JSON.stringify(extra),JSON.stringify(hidden),stamp);
const unhide=id=>sql.prepare('DELETE FROM crm_member_permissions WHERE member_id=?').run(id);
const note=(as,activityId,status=200)=>call(reviews.POST,{as,body:{kind:'entry',requestId:crypto.randomUUID(),activityId,result:'زيارة جيدة',action:'جهّز عرض السعر',rating:'effective',version:null}},status);

// 2.1 The supervisor: their own representatives, in their regions, on the last 7 days; never their own work, never another team's.
let sup=await pending('sup');
eq([sup.ok,sup.days],[true,7],'the answer');
eq(lines(sup),[['rep1','2026-11-15',3],['rep1','2026-11-14',1],['rep3','2026-11-13',1],['rep1','2026-11-09',1],['rep3','2026-11-09',1]],'sup: rep1 and rep3 day by day (visits, calls and follow-ups), the newest first');
eq(sup.total,7,'the total is the sum of the lines');
eq(sup.items.map(i=>i.name),['اسم rep1','اسم rep1','اسم rep3','اسم rep1','اسم rep3'],'with each one\'s name');
ok(!JSON.stringify(sup).includes('a08')&&!sup.items.some(i=>i.date==='2026-11-08'),'2026-11-08 is outside the 7 days');
eq(sup.items.filter(i=>i.memberId==='rep3'&&i.date==='2026-11-09')[0].pending,1,'the window opens at 00:00 Riyadh: the visit stored at 00:00:00 of the 9th counts, the one at 23:59:59 of the 8th does not');
ok(!sup.items.some(i=>i.memberId==='rep2'||i.memberId==='repw'||i.memberId==='sup'||i.memberId==='mgr'),'not another supervisor\'s representative, not one outside the regions, not the reader\'s own work, not a manager\'s');
// The count is exactly what the reader's own day report offers to note and has no note, member by member and day by day.
async function sameAsDayReport(as,data){
 for(const date of rules.reviewPendingDates('2026-11-15'))for(const memberId of ['rep1','rep2','rep3','repw']){
  user(as);const response=await reviews.GET(new Request('https://test.invalid/api/reviews?date='+date+'&memberId='+memberId));
  if(response.status!==200)continue;
  const report=await response.json(),waiting=report.reviewable.filter(id=>!report.entries.some(entry=>entry.activityId===id)).length;
  eq(data.items.find(i=>i.memberId===memberId&&i.date===date)?.pending||0,waiting,as+': '+memberId+' on '+date+' is the day report\'s count without a note');
 }
}
await sameAsDayReport('sup',sup);
// 2.2 The other supervisor and the sales managers: each their own team.
const sup2=await pending('sup2');eq(lines(sup2),[['rep2','2026-11-15',1],['rep2','2026-11-12',1]],'sup2: rep2 only');await sameAsDayReport('sup2',sup2);
const mgr=await pending('mgr');
eq(lines(mgr),[['rep1','2026-11-15',3],['rep2','2026-11-15',1],['repw','2026-11-15',1],['rep1','2026-11-14',1],['rep3','2026-11-13',1],['rep2','2026-11-12',1],['rep1','2026-11-09',1],['rep3','2026-11-09',1]],'the sales manager of every region: all representatives (a supervisor\'s own visit is not a representative\'s)');
eq(mgr.total,10,'their total');await sameAsDayReport('mgr',mgr);
const mgre=await pending('mgre');ok(!mgre.items.some(i=>i.memberId==='repw')&&mgre.items.some(i=>i.memberId==='rep2'),'a sales manager of the eastern region: not the western representative');
// 2.3 Who is refused, and how.
eq((await pending(null,401)).error,'سجّل الدخول للوصول إلى التطبيق.','anonymous: 401');
eq((await pending('rep1',403)).error,'تقرير خط السير متاح للمشرف ومدير المبيعات فقط','a representative: 403 (the day report\'s own door)');
eq((await pending('cs',403)).error,'هذا الإجراء متاح لفريق المبيعات فقط','customer service: 403');
eq((await pending('owner',403)).error,'بطاقة الزيارات والمتابعات بلا نتيجة أو إجراء متاحة للمشرف ومدير المبيعات فقط.','the administrator: 403, the card is not theirs');
hide('sup',['journeys']);eq((await pending('sup',404)).error,'هذا الجزء غير متاح لحسابك. راجع مدير النظام.','«تقرير يوم المندوب» hidden: 404');unhide('sup');
hide('sup',[],{'journeys:add':false});eq([(await pending('sup')).total,(await pending('mgr')).total],[0,10],'«إضافة» on the day report switched off: nothing to note, so nothing waits (the day report offers nothing either); others unaffected');unhide('sup');
hide('sup2',[],{viewAll:true});eq(lines(await pending('sup2')),lines(sup2),'«عرض بيانات الفريق بالكامل» widens nothing (the day report notes the team as the role defines it)');unhide('sup2');
// 2.4 A saved note takes its visit off at once; a day with every visit noted leaves the card; another reviewer's note counts too.
await note('sup','a15');
eq(lines(await pending('sup')).slice(0,1),[['rep1','2026-11-15',2]],'one note saved: 3 -> 2');
await note('sup','b15');await note('sup','f15');
eq((await pending('sup')).items.some(i=>i.memberId==='rep1'&&i.date==='2026-11-15'),false,'every visit of the day noted: the line is gone');
await note('mgr','a14');eq((await pending('sup')).items.some(i=>i.memberId==='rep1'&&i.date==='2026-11-14'),false,'a note by the sales manager is a note too (the day report shows it)');
eq((await pending('mgr')).total,6,'and the sales manager\'s total drops with them');
// 2.5 A deleted visit leaves the count; a representative moved to another supervisor moves with their work.
sql.prepare("DELETE FROM crm_records WHERE id='r3'").run();eq((await pending('sup')).items.some(i=>i.memberId==='rep3'&&i.date==='2026-11-13'),false,'a deleted visit is no longer counted');
sql.prepare("UPDATE crm_members SET supervisor_id='sup2' WHERE id='rep3'").run();
ok(!(await pending('sup')).items.some(i=>i.memberId==='rep3')&&(await pending('sup2')).items.some(i=>i.memberId==='rep3'),'rep3 moved to sup2: their waiting work moves with them');
sql.prepare("UPDATE crm_members SET supervisor_id='sup' WHERE id='rep3'").run();
// 2.6 The window moves at 00:00 Riyadh: at 23:59:59 of the 15th the 9th is in; one second later (the 16th) it is out and the 16th is in.
clock=NativeDate.parse('2026-11-15T20:59:59.000Z');ok((await pending('sup')).items.some(i=>i.date==='2026-11-09'),'23:59:59 of the 15th: the 9th still counts');
clock=NativeDate.parse('2026-11-15T21:00:00.000Z');
const next=await pending('sup');ok(!next.items.some(i=>i.date==='2026-11-09'),'00:00 of the 16th: the 9th is out');
eq(next.items[0].date,'2026-11-16','and the visit dated the 16th is in, the newest line');
clock=NativeDate.parse('2026-11-15T08:00:00.000Z');

// ---- 3. The card as React draws it.
const nativeRequire=createRequire(import.meta.url);let language='ar';
const dictionary=JSON.parse(fs.readFileSync('lib/locales/en.json','utf8'));
const i18n={useLanguage:()=>({language}),getLanguage:()=>language,direction:()=>language==='ar'?'rtl':'ltr',t:value=>language==='en'&&typeof value==='string'?(dictionary[value]||value):value};
const icons=new Proxy({},{get:(_,name)=>props=>React.createElement('svg',{'data-icon':String(name),className:props?.className})});
// stubs: modules replaced by name (TeamHome's red card drawn as a marker, since the card itself draws nothing before its first answer).
function loader(stubs={}){
 const cache=new Map();
 const load=filename=>{
  if(cache.has(filename))return cache.get(filename);
  const exports={},record={exports};cache.set(filename,exports);
  const require=name=>{
   if(stubs[name])return stubs[name];
   if(name==='react')return React;if(name==='react/jsx-runtime')return jsx;if(name==='lucide-react')return icons;if(name.endsWith('.css'))return {};
   if(name==='@/lib/i18n')return i18n;
   const target=name.startsWith('@/')?name.slice(2):name.startsWith('.')?path.join(path.dirname(filename),name):null;
   if(!target)return nativeRequire(name);
   return load(fs.existsSync(path.join(root,target+'.ts'))?target+'.ts':target+'.tsx');
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,filename),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{exports,module:record,require,console,Intl,Date,crypto:globalThis.crypto,structuredClone,setTimeout,clearTimeout});
  return exports;
 };
 return load;
}
const load=loader();
const {ReviewPendingView,pendingDayLabel}=load('app/review-pending.tsx');
const {default:TeamHome}=loader({'./review-pending':{ReviewPendingCard:props=>React.createElement('i',{'data-stub-pending':props.me.id})}})('app/team-home.tsx');
eq([pendingDayLabel('2026-11-15','ar','2026-11-15'),pendingDayLabel('2026-11-14','ar','2026-11-15'),pendingDayLabel('2026-11-15','en','2026-11-15'),pendingDayLabel('2026-11-14','en','2026-11-15')],['اليوم','أمس','Today','Yesterday'],'today and yesterday in words');
eq([pendingDayLabel('2026-11-13','ar','2026-11-15'),pendingDayLabel('2026-11-13','en','2026-11-15')],['الجمعة، 13 نوفمبر','Friday 13 November'],'an earlier day: its weekday and date, Gregorian with Latin digits');
const sample={ok:true,days:7,total:16,items:[item('rep1','2026-11-15',3),item('rep2','2026-11-15',2),item('rep3','2026-11-14',1),item('rep1','2026-11-13',1),item('rep2','2026-11-13',2),item('rep3','2026-11-12',1),item('rep1','2026-11-11',2),item('rep2','2026-11-10',1),item('rep3','2026-11-10',2),item('rep1','2026-11-09',1)]};
// Walk the tree React would draw, pressing what a person presses.
const walk=(node,found=[])=>{if(!node||typeof node!=='object')return found;if(Array.isArray(node)){for(const child of node)walk(child,found);return found;}if(typeof node.type==='function')return walk(node.type(node.props),found);found.push(node);walk(node.props?.children,found);return found;};
const opened=[],view=data=>walk(React.createElement(ReviewPendingView,{data,onDayReport:(memberId,date)=>opened.push([memberId,date])}));
eq(view(null),[],'nothing while it loads');eq(view({ok:true,days:7,total:0,items:[]}),[],'nothing when nothing waits');
let html=renderToStaticMarkup(React.createElement(ReviewPendingView,{data:sample,onDayReport:()=>{}}));
ok(html.includes('زيارات ومتابعات بلا نتيجة أو إجراء: <b data-review-pending-total="true">16</b>'),'the title with the total');
eq((html.match(/data-review-pending-line=/g)||[]).length,8,'at most 8 lines');
ok(html.includes('وأيام أخرى: 2'),'then «وأيام أخرى: 2»');
ok(html.includes('class="review-pending no-print"')&&html.includes('review-pending-count'),'the red card\'s own classes (app/review-pending.css: the theme\'s --destructive)');
ok(html.indexOf('data-review-pending-line="rep1|2026-11-15"')<html.indexOf('data-review-pending-line="rep2|2026-11-15"'),'in the order the server gave');
const nodes=view(sample),button=selector=>nodes.find(node=>node.type==='button'&&Object.entries(selector).every(([key,value])=>node.props[key]===value));
button({'data-review-pending-line':'rep3|2026-11-12'}).props.onClick();eq(opened.at(-1),['rep3','2026-11-12'],'a line opens that representative\'s day report on that day');
button({'data-review-pending-open':true}).props.onClick();eq(opened.at(-1),['rep1','2026-11-15'],'the card\'s head opens the newest line');
const section=nodes.find(node=>node.type==='section');
section.props.onClick({target:{closest:()=>null}});eq(opened.at(-1),['rep1','2026-11-15'],'pressing anywhere else on the card opens the newest line');
const before=opened.length;section.props.onClick({target:{closest:()=>({})}});eq(opened.length,before,'a press on a line\'s button is that line\'s alone (no second opening)');
language='en';html=renderToStaticMarkup(React.createElement(ReviewPendingView,{data:sample,onDayReport:()=>{}}));
ok(html.includes('Visits and follow-ups with no result or action: <b data-review-pending-total="true">16</b>')&&html.includes('And other days: 2'),'English');
ok(!/[؀-ۿ]/.test(html.replace(/<[^>]*>/g,' ').replace(/اسم rep\d/g,'')),'no Arabic left in English but the names');
language='ar';
// Who gets it on the first screen (TeamHome): before every other card, for a supervisor or a sales manager while «تقرير يوم المندوب» is theirs.
const access=(input={})=>({version:1,off:[],hidden:[],viewAll:false,...input});
const person=(id,role,extra={})=>({id,role,name:'اسم '+id,email:id+'@yourrest.org',branch:'الرئيسي',supervisorId:role==='rep'?'sup':'',regionScope:'all',active:1,target:0,access:access(),...extra});
const home=me=>renderToStaticMarkup(React.createElement(TeamHome,{me,members:[me],customers:[],ownInactive:2,offline:false,onCustomers:()=>{},onDayReport:()=>{}}));
for(const [me,first] of [[person('sup','supervisor'),true],[person('mgr','manager'),true]]){html=home(me);eq(html.startsWith('<div class="team-home no-print"><i data-stub-pending="'+me.id+'"></i>'),first,me.role+': the red card first of all');}
for(const me of [person('owner','admin'),person('rep1','rep'),person('cs','customer_service'),person('sup','supervisor',{access:access({hidden:['journeys']})}),person('mgr','manager',{access:access({hidden:['journeys']})})])ok(!home(me).includes('data-stub-pending'),me.role+(me.access.hidden.length?' with «تقرير يوم المندوب» hidden':'')+': no red card');

console.log(JSON.stringify({ok:true,checks,coverage:'the red card: the 7 days and the window at 00:00 Riyadh, both teams\' scope, the count equal to the day report\'s waiting notes, a saved note, the refusals, a hidden screen, «إضافة» off, «عرض بيانات الفريق بالكامل», the card\'s lines and presses in Arabic and English, who gets it',realBrowser:false}));
