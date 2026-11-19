// «خطة الغد» / «خطط المناديب» (lib/daily-plans*.ts, migration 0022; GSCO 2.13.83 with the owner's decisions), without a build: the rules
// (the 22:00 deadline and «متأخرة», the next working day, the device's clock within its bounds, the stops' shape, the stops a reviewer
// added, changed or took out locked for the member, the completion of a stop by the member's visits and contacts with one activity closing
// one stop, «خارج الخطة», the reminder lines and their notices), the three permission cells and the screen, the Excel tables, the outbox's
// plan entry; then the routes GET/POST /api/daily-plans and GET /api/daily-plans/inbox on an isolated in-memory SQLite (the route modules
// compiled as the build does, the session faked, the clock held at chosen Riyadh times): who prepares, who reviews which team, a stale
// version (409), a retry from its receipt, a draft unseen by the reviewer, approve, approve with edits, return, the member locked out of
// the reviewer's stops, the late flag, the device's clock, the note one per reviewer and day, the export's range, a switched-off cell, a
// hidden screen, and GET /api/crm keeping the plans' audit rows out of its recent changes. Synthetic people and factories only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'daily-plans-')),work=fs.mkdtempSync(path.join(os.tmpdir(),'yourrest-daily-plans-')),seen=new Set();
process.on('exit',()=>{fs.rmSync(out,{recursive:true,force:true});fs.rmSync(work,{recursive:true,force:true});});
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};

// A clock the test holds: every `new Date()` and Date.now() of the modules reads it (a date given explicitly is itself).
const RealDate=Date;let held=RealDate.parse('2026-11-18T09:00:00Z');
class HeldDate extends RealDate{constructor(...args){if(args.length)super(...args);else super(held);}static now(){return held;}}
globalThis.Date=HeldDate;
/** Riyadh wall clock 'YYYY-MM-DD HH:MM' → the held instant. */
const at=wall=>{held=RealDate.parse(wall.replace(' ','T')+':00+03:00');return new RealDate(held).toISOString();};

function compile(relative){if(seen.has(relative))return;seen.add(relative);const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';compile(source);return 'from '+JSON.stringify(path.join(out,source.replace(/\.tsx?$/,'.mjs')));});fs.writeFileSync(dest,code);}
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const u=globalThis.testUser;if(!u)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version FROM crm_members WHERE user_id=?').bind(u.userId).first();return {...u,provider:'email-otp',memberId:m?.id||'missing',memberVersion:m?.auth_version};}`);
for(const name of ['daily-plans','daily-plans/inbox','crm'])compile('app/api/'+name+'/route.ts');
for(const name of ['lib/daily-plans.ts','lib/permissions.ts','lib/access.ts','lib/list-export.ts','lib/list-export-plans.ts','lib/offline-store.ts','lib/offline-review.ts','lib/request-body.ts'])compile(name);
const load=name=>import(pathToFileURL(path.join(out,name)));
const R=await load('lib/daily-plans.mjs'),P=await load('lib/permissions.mjs'),A=await load('lib/access.mjs'),L=await load('lib/list-export.mjs'),X=await load('lib/list-export-plans.mjs'),S=await load('lib/offline-store.mjs'),V=await load('lib/offline-review.mjs'),B=await load('lib/request-body.mjs');

// ---- 1. The days and the deadline.
eq(R.planDeadline('2026-11-21'),'2026-11-20T19:00:00.000Z','the plan of a day is due at 22:00 Riyadh the day before');
eq([R.planLate('2026-11-20T18:59:59.999Z','2026-11-21'),R.planLate('2026-11-20T19:00:00.000Z','2026-11-21'),R.planLate('2026-11-21T06:00:00.000Z','2026-11-21')],[false,true,true],'21:59:59 is on time; 22:00 and the next morning are late');
eq(['2026-11-17','2026-11-18','2026-11-19','2026-11-20','2026-11-21'].map(R.nextPlanDay),['2026-11-18','2026-11-19','2026-11-21','2026-11-21','2026-11-22'],'the next working day: Thursday\'s plan is Saturday\'s (Friday off)');
eq([R.isPlanWorkingDay('2026-11-20'),R.isPlanWorkingDay('2026-11-21'),R.isPlanWorkingDay('2026-02-30')],[false,true,false],'Friday is not a working day; a day that does not exist neither');
eq(['2026-11-18','2026-11-19','2026-11-25','2026-11-26','2026-11-17','2026-02-30','2026-11-18x',null].map(day=>R.planDateProblem(day,'2026-11-18')),[null,null,null,'far','past','invalid','invalid','invalid'],'today (late) to seven days ahead; a past, far or false day refused');
eq([R.riyadhDayOf('2026-11-18T20:59:00Z'),R.riyadhDayOf('2026-11-18T21:00:00Z'),R.riyadhHourOf('2026-11-18T19:30:00Z')],['2026-11-18','2026-11-19',22],'the Riyadh day and hour of an instant');
// The device's clock: trusted within a minute ahead and 48 hours behind the receipt, else the server's receipt.
const received='2026-11-20T08:00:00.000Z';
eq(R.planSentAt(null,received),{at:received,source:'server'},'no capture: the receipt');
eq(R.planSentAt({capturedAt:'2026-11-19T18:50:00.000Z',receivedAt:received},received),{at:'2026-11-19T18:50:00.000Z',source:'device'},'captured offline at 21:50, received the next morning: the device\'s time');
eq(R.planSentAt({capturedAt:'2026-11-18T07:59:00.000Z',receivedAt:received},received).source,'server','more than 48 hours old: the receipt');
eq(R.planSentAt({capturedAt:'2026-11-18T08:00:00.000Z',receivedAt:received},received).source,'device','exactly 48 hours: the device');
eq(R.planSentAt({capturedAt:'2026-11-20T08:01:01.000Z',receivedAt:received},received).source,'server','more than a minute ahead: the receipt');

// ---- 2. The stops.
eq(['','09:30',' ٠٩:٣٠ ','۲۳:۵۹','24:00','9:30','09:60',7,undefined].map(R.planTime),['','09:30','09:30','23:59',null,null,null,null,''],'a time: empty or HH:MM, Arabic digits read');
const stop=(customerId,kind='visit',extra={})=>({customerId,kind,time:'',note:'',...extra});
eq(R.parsePlanStops([stop('c1'),stop('c2','call',{time:'١٠:٠٠',note:'  عرض  '})]),{ok:true,stops:[stop('c1'),stop('c2','call',{time:'10:00',note:'عرض'})]},'stops read and trimmed');
for(const [value,problem,label] of [[[],'count','no stop'],[Array.from({length:31},()=>stop('c1')),'count','31 stops'],['x','list','not a list'],[[stop('c1',' visit')],'kind','a wrong kind'],[[stop('c 1')],'customer','a wrong customer id'],[[stop('c1','email')],'kind','email is not a plan kind'],[[stop('c1','visit',{time:'25:00'})],'time','a wrong time'],[[stop('c1','visit',{note:'ن'.repeat(301)})],'note','a note of 301 characters'],[[stop('c1','visit',{note:'a\u0001'})],'note','a control character'],[[{...stop('c1'),extra:1}],'list','an unknown key']])
 eq(R.parsePlanStops(value).problem,problem,label+' is refused');
eq(R.parsePlanStops([],{min:0}).ok,true,'a draft may be empty');
eq(R.parsePlanStops([stop('c1','visit',{id:'s1'}),stop('c2','call',{id:'s1'})]),{ok:false,problem:'list',index:1},'the same stop id twice is refused (review 2026-11-19: it changed a reviewer\'s stop past the lock)');
eq(R.parsePlanStops(Array.from({length:30},()=>stop('c1'))).ok,true,'30 stops are accepted');
const stored=(id,customerId,kind,supervisorState='',position=1)=>({id,position,customerId,kind,time:'',note:'',addedBy:supervisorState==='added'?'sup':'rep1',supervisorState,editedBy:supervisorState?'sup':null,createdAt:'t'});
const existing=[stored('s1','c1','visit','',1),stored('s2','c2','call','added',2),stored('s3','c3','visit','edited',3),stored('s4','c4','visit','removed',4)];
const keep=[{id:'s3',customerId:'c3',kind:'visit',time:'',note:''},{id:'s2',customerId:'c2',kind:'call',time:'',note:''},{customerId:'c5',kind:'whatsapp',time:'',note:''}];
eq(R.memberLockProblems(existing,keep),[],'the member keeps the reviewer\'s stops as they are (moved in the order) and drops their own');
eq(R.memberLockProblems(existing,keep.slice(1)),['s3'],'deleting a stop the reviewer edited is refused');
eq(R.memberLockProblems(existing,[{...keep[0],time:'10:00'},keep[1]]),['s3'],'changing it is refused');
eq(R.memberLockProblems(existing,[...keep,{id:'s4',customerId:'c4',kind:'visit',time:'',note:''}]),['s4'],'bringing back a stop the reviewer took out is refused');
let ids=0;const next=()=>'n'+(++ids);
const afterMember=R.memberStops(existing,keep,'rep1','now',next);
eq(afterMember.map(item=>[item.id,item.position,item.customerId,item.supervisorState]),[['s3',1,'c3','edited'],['s2',2,'c2','added'],['n1',3,'c5',''],['s4',4,'c4','removed']],'the member\'s list in its order, then what the reviewer took out');
const live=[stored('a','c1','visit','',1),stored('b','c2','call','',2),stored('c','c3','visit','added',3)];
let edited=R.reviewerStops(live,[{id:'a',customerId:'c1',kind:'visit',time:'09:00',note:''},{customerId:'c6',kind:'call',time:'',note:''}],'sup','now',next);
eq(edited.stops.map(item=>[item.id,item.position,item.supervisorState,item.editedBy]),[['a',1,'edited','sup'],['n2',2,'added','sup'],['b',3,'removed','sup']],'the reviewer\'s edits: changed, added, the member\'s stop kept as removed, their own addition dropped');
eq(edited.changed,true,'changed');
eq(R.reviewerStops(live,live.map(({id,customerId,kind,time,note})=>({id,customerId,kind,time,note})),'sup','now',next).changed,false,'the same list is no change');
eq(R.reviewerStops(live,[live[1],live[0],live[2]].map(({id,customerId,kind,time,note})=>({id,customerId,kind,time,note})),'sup','now',next).changed,true,'a new order is a change');
eq(R.reviewerStops([stored('c','c3','visit','added',1)],[{id:'c',customerId:'c4',kind:'visit',time:'',note:''}],'mgr','now',next).stops[0].supervisorState,'added','a reviewer\'s addition changed again stays «أضافها المشرف»');

// ---- 3. Completion: one activity closes one stop; the same kind first, then another; «خارج الخطة».
const plan=[stored('p1','c1','visit','',1),stored('p2','c1','call','',2),stored('p3','c2','visit','',3),stored('p4','c3','whatsapp','',4),stored('p5','c4','visit','removed',5),stored('p6','c5','visit','',6)];
const act=(id,customerId,type,time)=>({id,customerId,type,at:'2026-11-19T'+time+':00.000Z'});
let done=R.planCompletion(plan,[act('x1','c1','call','06:00'),act('x2','c1','visit','07:00'),act('x3','c2','call','08:00'),act('x4','c3','visit','09:00'),act('x5','c9','visit','10:00'),act('x6','c1','visit','11:00'),act('x7','c4','visit','12:00'),act('x8','c5','email','13:00')]);
eq(done.stops.map(item=>[item.id,item.state,item.activityId]),[['p1','done','x2'],['p2','done','x1'],['p3','done_other','x3'],['p4','done_other','x4'],['p5','removed',null],['p6','done_other','x8']],'the same kind closes its stop whatever the order; another kind closes «تمت بطريقة تواصل أخرى»; a removed stop never');
eq(done.activities.map(item=>[item.id,item.place]),[['x1','planned'],['x2','planned'],['x3','planned'],['x4','planned'],['x5','outside'],['x6','extra'],['x7','outside'],['x8','planned']],'a customer not in the plan is outside it (a removed stop\'s customer too); a second visit to a planned customer is extra');
eq(done.counts,{stops:5,done:2,doneOther:3,open:0,removed:1,outside:2,extra:1},'the counts');
done=R.planCompletion([stored('q1','c1','visit','',1),stored('q2','c1','visit','',2)],[act('y1','c1','visit','07:00')]);
eq(done.stops.map(item=>item.state),['done','open'],'one visit closes one of two visits to the same customer');
eq(R.planCompletion([],[act('z1','c1','call','07:00')]).counts,{stops:0,done:0,doneOther:0,open:0,removed:0,outside:1,extra:0},'no plan: everything is outside');

// ---- 4. The reminder lines and their notices.
const memberInbox=(next,today=null)=>({ok:true,serverTime:'',role:'member',next:{date:'2026-11-19',state:'missing',late:false,deadline:R.planDeadline('2026-11-19'),version:null,returnReason:'',reviewedByName:'',...next},today});
const keys=(value,wall)=>R.planReminderLines(value,RealDate.parse(wall.replace(' ','T')+':00+03:00')).map(line=>line.key);
eq(keys(memberInbox({}),'2026-11-18 15:59'),[],'before 16:00 on the day before: nothing');
eq(keys(memberInbox({}),'2026-11-18 16:00'),['due:2026-11-19'],'from 16:00: due');
eq(keys(memberInbox({}),'2026-11-17 18:00'),[],'two days before: nothing');
eq(keys(memberInbox({}),'2026-11-18 22:00'),['late:2026-11-19'],'from 22:00: late');
eq(keys(memberInbox({state:'draft'}),'2026-11-18 21:00'),['due:2026-11-19'],'a draft is not sent');
eq(keys(memberInbox({state:'sent'}),'2026-11-18 21:00'),[],'sent: nothing');
eq(keys(memberInbox({state:'returned',version:3}),'2026-11-18 10:00'),['returned:2026-11-19:3'],'returned: at any hour');
eq(keys(memberInbox({state:'approved_edited',version:4}),'2026-11-18 21:00'),['approved:2026-11-19:4'],'approved: a notice');
eq(keys(memberInbox({state:'sent'},{date:'2026-11-18',state:'missing',late:false,deadline:'',version:null}),'2026-11-18 08:00'),['missing-today:2026-11-18'],'today\'s plan never sent');
const reviewer={ok:true,serverTime:'',role:'reviewer',pending:[{memberId:'rep1',name:'أ',date:'2026-11-19',late:true,firstSentAt:null,version:2}],missing:{date:'2026-11-19',names:['ب','ج']}};
eq(keys(reviewer,'2026-11-18 22:30'),['pending:rep1:2026-11-19:2','missing:2026-11-19:2'],'the reviewer: each plan waiting, and who has not sent');
const lines=R.planReminderLines(memberInbox({}),RealDate.parse('2026-11-18T19:00:00+03:00'));
eq(R.planNoticeStep(lines,null,RealDate.parse('2026-11-18T19:00:00+03:00')),{announce:[],remember:[]},'a due plan before 20:00 is not announced (and not remembered)');
const step=R.planNoticeStep(lines,[],RealDate.parse('2026-11-18T20:00:00+03:00'));
eq([step.announce.map(line=>line.key),step.remember],[['due:2026-11-19'],['due:2026-11-19']],'from 20:00 it is announced once');
eq(R.planNoticeStep(lines,step.remember,RealDate.parse('2026-11-18T20:30:00+03:00')).announce,[],'and not again');
eq(R.planNoticeStep(lines,null,RealDate.parse('2026-11-18T20:30:00+03:00')).announce,[],'a browser that remembers nothing announces nothing at first');
eq([R.rememberedPlanNotices(null),R.rememberedPlanNotices('{'),R.rememberedPlanNotices('[1,"a"]')],[null,null,['a']],'what the browser remembers');

// ---- 5. The permissions, the screen, the export, the outbox.
const ROLES=['admin','manager','supervisor','rep','marketing','customer_service','customer_service_manager'];
eq(ROLES.map(role=>A.canViewPage(role,'plans')),[true,true,true,true,true,false,false],'the screen: the sales team');
eq(ROLES.map(role=>['add','edit','export'].map(action=>P.cellCeiling(role,'plans',action))),[[false,true,true],[false,true,true],[false,true,true],[true,false,false],[true,false,false],[false,false,false],[false,false,false]],'«إعداد خطة اليوم» for the field roles; «مراجعة خطط المناديب» and «تصدير خطط المناديب إلى Excel» for the three reviewers');
eq(P.permissionRow('plans').cells.add.ar,'إعداد خطة اليوم','the owner\'s three names');eq(P.permissionRow('plans').cells.edit.ar,'مراجعة خطط المناديب','');eq(P.permissionRow('plans').cells.export.ar,'تصدير خطط المناديب إلى Excel','');
for(const role of ROLES)for(const action of ['add','edit','export'])eq(P.can({role,access:P.memberAccess(role,null)},'plans',action),P.cellCeiling(role,'plans',action),role+' plans:'+action+' on by default within the ceiling');
const offRep={role:'rep',access:P.memberAccess('rep',{permissions:JSON.stringify({'plans:add':false}),hidden:'[]',version:2})};
eq([P.can(offRep,'plans','add'),P.cellRefused(offRep,'plans','add')],[false,true],'switched off: refused');
eq(P.pageAllowed({role:'rep',access:P.memberAccess('rep',{permissions:'{}',hidden:'["plans"]',version:2})},'plans'),false,'hidden: not shown');
eq(A.resolveCRMPage('rep','plans'),'plans','an address names the page');
eq(['admin','manager','supervisor','rep','marketing'].map(role=>L.mayExportList({role,access:P.memberAccess(role,null)},'plans')),[true,true,true,false,false],'the reviewers export, a field member never');
eq(L.listExportFileName('plans','2026-11-19'),'Yourrest-daily-plans-2026-11-19.xlsx','the file name');
eq(B.jsonRequestLimit(new Request('https://x.invalid/api/daily-plans')),60000,'the route\'s body limit');
const view={ok:true,memberId:'rep1',memberName:'المندوب أحمد',date:'2026-11-19',applies:true,id:'p',state:'approved_edited',status:'approved_edited',version:3,late:true,deadline:'2026-11-18T19:00:00.000Z',firstSentAt:'2026-11-18T19:30:00.000Z',firstSentSource:'device',sentAt:'2026-11-18T19:30:00.000Z',reviewedByName:'المشرف',reviewedAt:'2026-11-18T20:00:00.000Z',returnReason:'',updatedAt:'',
 stops:[{id:'s1',position:1,customerId:'c1',customerName:'=مصنع',kind:'visit',time:'09:00',note:'عرض',addedBy:'rep1',addedByName:'',supervisorState:'edited',editedByName:'المشرف',completion:'done',activityId:'a1',activityType:'visit',doneAt:'2026-11-19T06:00:00.000Z'}],
 activities:[{id:'a2',customerId:'c9',customerName:'آخر',type:'call',at:'2026-11-19T07:00:00.000Z',place:'outside'}],counts:{stops:1,done:1,doneOther:0,open:0,removed:0,outside:1,extra:0},notes:[{reviewerId:'sup',reviewerName:'المشرف',note:'جيد',version:1,updatedAt:''}],
 canEdit:false,canApprove:false,canReviewEdit:false,canReturn:false,canNote:false,myNote:null,serverTime:''};
eq(R.validPlanView(view),true,'a plan view is valid');
let tables=X.planTables([view],'ar');
eq(tables.map(table=>[table.name[0],table.rows.length]),[['الخطط',1],['المحطات',1],['خارج الخطة',1]],'three sheets');
eq([tables[0].rows[0][0],tables[0].rows[0][2],tables[0].rows[0][3],tables[0].rows[0][5],tables[0].rows[0][11]],['المندوب أحمد','معتمدة مع تعديل','نعم','ساعة الجهاز',1],'the plan row in Arabic');
eq([tables[1].rows[0][3],tables[1].rows[0][4],tables[1].rows[0][7],tables[1].rows[0][8]],['=مصنع','زيارة','عدّلها المشرف · المشرف','تمت'],'the stop row (a name that looks like a formula stays text)');
tables=X.planTables([view],'en');
eq([tables[0].header[0],tables[0].rows[0][2],tables[1].rows[0][4],tables[2].rows[0][5]],['Representative','Approved with edits','Visit','Outside the plan'],'and in English');
ok(L.listWorkbook(tables,'en').bytes.length>1000,'the workbook is written');
eq(S.offlineProjection({kind:'plan',body:JSON.stringify({action:'send',date:'2026-11-19',stops:[]}),capturedAt:'2026-11-18T19:00:00.000Z'},{id:'rep1',email:'rep1@yourrest.org'}),undefined,'a plan kept on the device projects no record');
eq([V.offlineEntryNoun('plan','ar'),V.offlineEntryNoun('plan','en')],['خطة اليوم','Day plan'],'the device\'s list names it');
eq(V.offlineReview({kind:'plan',url:'/api/daily-plans',body:'{}',localId:'x',status:'blocked',message:'تغيّرت الخطة منذ فتحها. حدّث الصفحة قبل الحفظ.',httpStatus:404},[],{id:'rep1'}),null,'a refused plan is said in the server\'s words');

// ---- 6. The routes on an isolated database.
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
const migrations=fs.readdirSync(path.join(root,'drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).sort();
eq(migrations.at(-1),'0022_daily_plans.sql','the newest migration');
for(const name of migrations)sql.exec(fs.readFileSync(path.join(root,'drizzle',name),'utf8'));
class Statement{constructor(q,a=[]){this.q=q;this.a=a;}bind(...a){return new Statement(this.q,a);}async run(){const r=sql.prepare(this.q).run(...this.a);return{meta:{changes:Number(r.changes)}};}async all(){return{results:sql.prepare(this.q).all(...this.a)};}async first(){return sql.prepare(this.q).get(...this.a)||null;}}
let race=null;
const DB={prepare:q=>new Statement(q),batch:async statements=>{if(race){const fn=race;race=null;await fn();}sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(/^\s*(SELECT|WITH)/i.test(s.q)?{...await s.all(),meta:{changes:0}}:await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid'};
const created=new RealDate(held).toISOString();
const member=(id,role,supervisor=null,region='eastern')=>sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,1,0,?)').run(id,'u-'+id,id+'@yourrest.org','اسم '+id,role,'الرئيسي',supervisor,region,created);
member('owner','admin',null,'all');member('mgr','manager',null,'all');member('sup','supervisor','mgr');member('sup2','supervisor','mgr');
member('rep1','rep','sup');member('mk1','marketing','sup');member('rep2','rep','sup2');member('cs','customer_service','mgr');member('west','rep','sup','western');
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-owner')").run();
const record=(id,kind,parent,assigned,data,when=created)=>sql.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').run(id,kind,parent,assigned,'الرئيسي',JSON.stringify(data),when,when);
for(const [id,name] of [['c1','مصنع الشرق'],['c2','مصنع الخليج'],['c3','مصنع الدمام'],['c4','مصنع الجبيل']])record(id,'customer',null,'rep1',{name,region:'الشرقية',city:'الدمام',location:'26.43, 50.03'});
record('cW','customer',null,'west',{name:'مصنع الغرب',region:'الغربية',city:'جدة',location:'21.5, 39.2'});
const user=id=>{globalThis.testUser=id?{userId:'u-'+id,email:id+'@yourrest.org',fullName:id}:null;};
const plans=await load('app/api/daily-plans/route.mjs'),inboxRoute=await load('app/api/daily-plans/inbox/route.mjs'),crm=await load('app/api/crm/route.mjs');
const call=async(handler,{as,body,url='https://test.invalid/api/daily-plans',origin='https://test.invalid'},status=200)=>{
 user(as);const request=body===undefined?new Request(url):new Request(url,{method:'POST',headers:{origin,'content-type':'application/json'},body:typeof body==='string'?body:JSON.stringify(body)});
 const response=await handler(request),data=await response.json();eq(response.status,status,(as||'anonymous')+' '+url+' '+JSON.stringify(body||'').slice(0,160)+' -> '+JSON.stringify(data).slice(0,300));return data;
};
const get=(as,query,status)=>call(plans.GET,{as,url:'https://test.invalid/api/daily-plans?'+new URLSearchParams(query)},status);
const post=(as,body,status)=>call(plans.POST,{as,body:{requestId:crypto.randomUUID(),...body}},status);
const send=(as,date,stops,baseVersion,extra={},status)=>post(as,{action:'send',date,stops,baseVersion,...extra},status);
const review=(as,action,memberId,date,baseVersion,extra={},status)=>post(as,{action,memberId,date,baseVersion,...extra},status);
const inbox=as=>call(inboxRoute.GET,{as,url:'https://test.invalid/api/daily-plans/inbox'});
const audits=()=>sql.prepare("SELECT action FROM crm_audit WHERE action LIKE 'daily-plan:%' ORDER BY created_at,id").all().map(row=>row.action);
const D='2026-11-19';// Thursday; the deadline is Wednesday 2026-11-18 22:00 Riyadh.

at('2026-11-18 20:00');
// Nobody signed in, another origin, customer service.
await call(plans.GET,{as:null,url:'https://test.invalid/api/daily-plans?date='+D},401);
await call(plans.POST,{as:null,body:{}},401);
await call(inboxRoute.GET,{as:null,url:'https://test.invalid/api/daily-plans/inbox'},401);
await call(plans.POST,{as:'rep1',body:{action:'send'},origin:'https://evil.example'},403);
await get('cs',{date:D},403);await post('cs',{action:'send',date:D,stops:[stop('c1')],baseVersion:null},403);
eq((await inbox('cs')).role,'none','customer service has no plans');
// The member's own plan, empty.
let mine=await get('rep1',{date:D});
eq([mine.state,mine.version,mine.canEdit,mine.canApprove,mine.deadline,mine.applies],['missing',null,true,false,'2026-11-18T19:00:00.000Z',true],'nothing yet; the member may prepare it');
eq((await inbox('rep1')).next,{date:D,state:'missing',late:false,deadline:'2026-11-18T19:00:00.000Z',version:null,returnReason:'',reviewedByName:''},'the reminder sees the next day missing');
// Who prepares: not a reviewer, not another member's plan, not a customer outside the regions, not a past or far day.
await send('sup',D,[stop('c1')],null,{},403);
await send('rep1',D,[stop('cW')],null,{},403);await send('rep1',D,[stop('nothing')],null,{},403);
await send('rep1','2026-11-17',[stop('c1')],null,{},409);await send('rep1','2026-11-26',[stop('c1')],null,{},400);
await send('rep1',D,[],null,{},400);await post('rep1',{action:'send',date:D,stops:[stop('c1')],baseVersion:null,memberId:'rep2'},400);
// A draft the reviewer does not see.
let saved=await post('rep1',{action:'save',date:D,stops:[stop('c1')],baseVersion:null});
eq([saved.plan.state,saved.plan.version,saved.plan.stops.length,saved.plan.firstSentAt],['draft',1,1,null],'a draft is kept');
eq([(await get('sup',{date:D,memberId:'rep1'})).state,(await get('sup',{date:D,memberId:'rep1'})).stops],['missing',[]],'the reviewer reads «لم تُرسل» without its stops');
// The send, on time; a retry from its receipt; the same key with other stops; a stale version.
at('2026-11-18 21:30');
const requestId=crypto.randomUUID(),first=[stop('c1'),stop('c2','call',{time:'10:30',note:'عرض السعر'}),stop('c3','whatsapp')];
saved=await post('rep1',{action:'send',date:D,stops:first,baseVersion:1,requestId});
eq([saved.plan.state,saved.plan.version,saved.plan.late,saved.plan.firstSentAt,saved.plan.firstSentSource,saved.plan.stops.map(item=>[item.position,item.customerName,item.kind,item.time])],['sent',2,false,'2026-11-18T18:30:00.000Z','server',[[1,'مصنع الشرق','visit',''],[2,'مصنع الخليج','call','10:30'],[3,'مصنع الدمام','whatsapp','']]],'sent at 21:30: on time, version 2');
eq((await post('rep1',{action:'send',date:D,stops:first,baseVersion:1,requestId})).plan.version,2,'the same request again answers from its receipt');
eq(audits(),['daily-plan:save','daily-plan:send'],'written once');
await post('rep1',{action:'send',date:D,stops:first.slice(1),baseVersion:1,requestId},409);
eq((await send('rep1',D,first,1,{},409)).error,'تغيّرت الخطة منذ فتحها. حدّث الصفحة قبل الحفظ.','a stale version is refused');
await post('rep1',{action:'save',date:D,stops:first,baseVersion:2},409);
// Who reads it: the supervisor, the sales manager, the administrator; not another team's supervisor nor another representative.
for(const who of ['sup','mgr','owner'])eq((await get(who,{date:D,memberId:'rep1'})).state,'sent',who+' reads it');
await get('sup2',{date:D,memberId:'rep1'},403);await get('rep2',{date:D,memberId:'rep1'},403);await get('rep1',{date:D,memberId:'rep2'},403);
let list=await get('sup',{date:D});
eq(list.rows.map(row=>[row.memberId,row.state,row.overdue]),[['rep1','sent',false],['mk1','missing',false]],'the supervisor\'s list: their team in their regions, the waiting plan first');
eq((await get('sup2',{date:D})).rows.map(row=>row.memberId),['rep2'],'another supervisor: their own team');
eq((await get('mgr',{date:D})).rows.map(row=>row.memberId).sort(),['mk1','rep1','rep2','west'],'the sales manager: every field member');
let waiting=await inbox('sup');
eq([waiting.role,waiting.pending.map(item=>[item.memberId,item.date,item.late,item.version]),waiting.missing],['reviewer',[['rep1',D,false,2]],{date:'2026-11-18',names:['اسم mk1','اسم rep1']}],'the supervisor\'s card: the plan waiting; before the next deadline, who has no plan for today');
// The reviewer's actions: a stale version, then approve; the member can no longer send.
await review('sup','approve','rep1',D,1,{},409);await review('sup2','approve','rep1',D,2,{},403);await review('rep2','approve','rep1',D,2,{},403);
await review('sup','approve','sup',D,2,{},400);
saved=await review('sup','approve','rep1',D,2);
eq([saved.plan.state,saved.plan.version,saved.plan.reviewedByName,saved.plan.canApprove,saved.plan.canReviewEdit],['approved',3,'اسم sup',false,true],'approved');
await review('sup','approve','rep1',D,3,{},409);
eq((await send('rep1',D,first,3,{},409)).error,'الخطة معتمدة؛ لا يمكنك تعديلها. اطلب من المشرف إعادتها إليك إذا احتجت إلى تعديلها.','an approved plan is closed to the member');
// Approve with edits: the stop of c1 at 09:00, c4 added, the whatsapp to c3 taken out.
let current=await get('sup',{date:D,memberId:'rep1'});
const [s1,s2]=current.stops;
await review('sup','approve_edited','rep1',D,3,{stops:current.stops.map(({id,customerId,kind,time,note})=>({id,customerId,kind,time,note}))},400);
await review('sup','approve_edited','rep1',D,3,{stops:[{id:s1.id,customerId:'c1',kind:'visit',time:'09:00',note:''},{id:s2.id,customerId:s2.customerId,kind:s2.kind,time:s2.time,note:s2.note},{customerId:'cW',kind:'call',time:'',note:''}]},403);
saved=await review('sup','approve_edited','rep1',D,3,{stops:[{id:s1.id,customerId:'c1',kind:'visit',time:'09:00',note:''},{id:s2.id,customerId:s2.customerId,kind:s2.kind,time:s2.time,note:s2.note},{customerId:'c4',kind:'call',time:'',note:'متابعة'}]});
eq([saved.plan.state,saved.plan.version,saved.plan.stops.map(item=>[item.position,item.customerId,item.time,item.supervisorState,item.completion])],['approved_edited',4,[[1,'c1','09:00','edited','open'],[2,'c2','10:30','','open'],[3,'c4','','added','open'],[4,'c3','','removed','removed']]],'the edits apply at once and show as edited, added and removed');
// Returned with a reason; the member may not delete or change the reviewer's stops, nor bring one back.
await review('sup','return','rep1',D,4,{reason:'x'},400);
saved=await review('sup','return','rep1',D,4,{reason:'أضف زيارة لمصنع الخليج'});
eq([saved.plan.state,saved.plan.returnReason],['returned','أضف زيارة لمصنع الخليج'],'returned with the reason');
eq((await inbox('rep1')).next.state,'returned','the member\'s card says it');
const back=(await get('rep1',{date:D})).stops,byId=new Map(back.map(item=>[item.customerId+':'+item.supervisorState,item]));
const edited1=byId.get('c1:edited'),added4=byId.get('c4:added'),removed3=byId.get('c3:removed'),own2=byId.get('c2:');
const wire=item=>({id:item.id,customerId:item.customerId,kind:item.kind,time:item.time,note:item.note});
eq((await send('rep1',D,[wire(own2),wire(added4)],5,{},403)).error,'لا يمكنك حذف محطة أضافها المشرف أو عدّلها، ولا تغييرها.','deleting the edited stop is refused');
await send('rep1',D,[{...wire(edited1),time:'11:00'},wire(own2),wire(added4)],5,{},403);
await send('rep1',D,[wire(edited1),wire(own2),wire(added4),wire(removed3)],5,{},403);
// A reviewer's stop sent twice by its id, once changed (to a customer of another region) and once as it is: refused, nothing changes
// (before the review of 2026-11-19 the lock read the second copy and the first was written under «أضافها المشرف», its customer unchecked).
const stopsNow=()=>sql.prepare("SELECT id,customer_id,kind,note,supervisor_state,added_by FROM crm_daily_plan_stops WHERE plan_id='daily-plan:rep1:'||? ORDER BY position").all(D);
const beforeTwice=stopsNow();
eq((await send('rep1',D,[{...wire(added4),customerId:'cW',kind:'visit',note:'غيّرها المندوب'},wire(added4),wire(edited1),wire(own2)],5,{},400)).error,'بيانات الخطة غير صحيحة.','a stop sent twice by its id is refused');
eq(stopsNow(),beforeTwice,'the reviewer\'s stop is as the reviewer left it');
at('2026-11-18 23:10');
saved=await send('rep1',D,[wire(added4),wire(edited1),wire(own2),stop('c2','visit')],5);
eq([saved.plan.state,saved.plan.late,saved.plan.firstSentAt,saved.plan.stops.map(item=>[item.position,item.customerId,item.kind,item.supervisorState])],['sent',false,'2026-11-18T18:30:00.000Z',[[1,'c4','call','added'],[2,'c1','visit','edited'],[3,'c2','call',''],[4,'c2','visit',''],[5,'c3','whatsapp','removed']]],'sent again after 22:00: still on time (the first send decides), the reviewer\'s stops kept');
// Late: the marketing officer sends after the deadline.
saved=await send('mk1',D,[stop('c1','call')],null);
eq([saved.plan.state,saved.plan.late,saved.plan.firstSentSource],['sent',true,'server'],'a marketing officer\'s plan sent at 23:10 is accepted and late');
// The device's clock: captured at 21:50, received the next morning → on time; 49 hours old → the receipt; ahead or another member → refused.
at('2026-11-21 08:00');
const S2='2026-11-21';// Saturday; its deadline is Friday 22:00.
await send('rep2',S2,[stop('c1')],null,{offline:{memberId:'rep1',capturedAt:'2026-11-20T18:50:00.000Z'}},403);
await send('rep2',S2,[stop('c1')],null,{offline:{memberId:'rep2',capturedAt:'2026-11-21T05:02:00.000Z'}},400);
saved=await send('rep2',S2,[stop('c1')],null,{offline:{memberId:'rep2',capturedAt:'2026-11-20T18:50:00.000Z'}});
eq([saved.plan.late,saved.plan.firstSentAt,saved.plan.firstSentSource],[false,'2026-11-20T18:50:00.000Z','device'],'made on the device at 21:50 Friday, received Saturday morning: on time by the device\'s clock');
saved=await send('mk1',S2,[stop('c1')],null,{offline:{memberId:'mk1',capturedAt:'2026-11-19T04:00:00.000Z'}});
eq([saved.plan.late,saved.plan.firstSentSource],[true,'server'],'a device time more than 48 hours old is not trusted: the receipt, late');
// Completion on the plan's day, read by the supervisor.
at('2026-11-19 18:00');
const visit=(id,by,customer,type,time,extra={})=>record(id,'activity',customer,by,{type,date:D,summary:'تعريف',result:'تمت',performedBy:by,responsibleId:by,recordedByEmail:by+'@yourrest.org',...extra},'2026-11-19T'+time+':00.000Z');
visit('v1','rep1','c1','visit','06:00');visit('v2','rep1','c4','whatsapp','07:00');visit('v3','rep1','c3','visit','08:00');visit('v4','rep1','c2','call','09:00');visit('v5','rep1','c2','call','10:00');visit('v6','rep2','c1','visit','06:30');
current=await get('sup',{date:D,memberId:'rep1'});
eq(current.stops.map(item=>[item.customerId,item.kind,item.completion,item.activityId]),[['c4','call','done_other','v2'],['c1','visit','done','v1'],['c2','call','done','v4'],['c2','visit','done_other','v5'],['c3','whatsapp','removed',null]],'the visits and contacts of the day close the stops, one each');
eq([current.counts,current.activities.map(item=>[item.id,item.place,item.customerName])],[{stops:4,done:2,doneOther:2,open:0,removed:1,outside:1,extra:0},[['v3','outside','مصنع الدمام']]],'the visit to the customer the supervisor took out is outside the plan; another member\'s visit is not counted');
eq((await get('sup',{date:D})).rows.find(row=>row.memberId==='rep1').counts.done,2,'the list carries the counts');
// The note: one per reviewer and day, versioned; each reviewer has their own; the member reads them.
let noted=await review('sup','note','rep1',D,undefined,{note:'خطة جيدة ومتوازنة',noteVersion:null});
eq([noted.plan.myNote.version,noted.plan.myNote.note],[1,'خطة جيدة ومتوازنة'],'the supervisor\'s note');
eq((await review('sup','note','rep1',D,undefined,{note:'ملاحظة ثانية',noteVersion:null},409)).error,'تغيّرت ملاحظتك على هذا اليوم. حدّث الصفحة قبل الحفظ.','one note per reviewer and day: a second «new» note is refused');
noted=await review('sup','note','rep1',D,undefined,{note:'خطة جيدة، زد الاتصالات',noteVersion:1});
eq(noted.plan.myNote.version,2,'the note edited');
await review('mgr','note','rep1',D,undefined,{note:'اطلعت',noteVersion:null});
await review('sup','note','rep1',D,undefined,{note:'ن',noteVersion:2},400);await review('sup2','note','rep1',D,undefined,{note:'ملاحظة',noteVersion:null},403);
eq((await get('rep1',{date:D})).notes.map(item=>[item.reviewerId,item.note]).sort(),[['mgr','اطلعت'],['sup','خطة جيدة، زد الاتصالات']],'the member reads both notes');
eq(sql.prepare('SELECT COUNT(*) n FROM crm_daily_plan_notes').get().n,2,'two notes, one per reviewer');
// A past day is closed to everything but the note.
at('2026-11-20 09:00');
await review('sup','approve','rep1',D,6,{},409);await send('rep1',D,[stop('c1')],6,{},409);
await review('sup','note','rep1',D,undefined,{note:'بعد اليوم',noteVersion:2});
// A request written just before midnight and sent again after it (a lost answer, the device's outbox) answers from its receipt, not «انتهى
// يوم هذه الخطة» (review 2026-11-19: the day was checked before the receipt); a new request on the ended day is still refused.
const M='2026-11-23';// Monday.
at(M+' 23:59');
const lateSend={action:'send',date:M,stops:[stop('c1')],baseVersion:null,requestId:crypto.randomUUID()};
saved=await post('rep1',lateSend);
eq([saved.plan.state,saved.plan.version,saved.plan.late],['sent',1,true],'today\'s plan sent at 23:59: late');
const approval={action:'approve',memberId:'rep1',date:M,baseVersion:1,requestId:crypto.randomUUID()};
eq((await post('sup',approval)).plan.state,'approved','approved at 23:59');
at('2026-11-24 00:01');
eq([(await post('rep1',lateSend)).plan.version,(await post('sup',approval)).plan.state],[2,'approved'],'both sent again after midnight answer from their receipts');
eq(sql.prepare("SELECT action FROM crm_audit WHERE record_id='daily-plan:rep1:'||? ORDER BY created_at,id").all(M).map(row=>row.action),['daily-plan:send','daily-plan:approve'],'each written once');
await send('rep1',M,[stop('c2')],2,{},409);await review('sup','return','rep1',M,2,{reason:'بعد انتهاء اليوم'},409);
at('2026-11-20 09:00');
// The export: the reviewer's team over a range; at most 31 days; never a field member.
let exported=await get('sup',{from:'2026-11-19',to:'2026-11-21'});
eq(exported.plans.map(item=>[item.memberId,item.date,item.state]),[['mk1','2026-11-19','sent'],['rep1','2026-11-19','sent'],['mk1','2026-11-21','sent']],'the plans of the range (the working days without one up to today too)');
await get('sup',{from:'2026-11-01',to:'2026-12-02'},400);await get('sup',{from:'2026-11-21',to:'2026-11-19'},400);await get('rep1',{from:'2026-11-19',to:'2026-11-19'},403);
// Switched off and hidden: the cell refuses with its words; a hidden screen answers 404.
sql.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_by,updated_at) VALUES('sup',?,'[]',2,'owner',?)").run(JSON.stringify({'plans:edit':false,'plans:export':false}),created);
eq((await review('sup','note','rep1',D,undefined,{note:'محاولة',noteVersion:3},403)).error,'غير مسموح لك بالتعديل في خطط المناديب. راجع مدير النظام.','«مراجعة خطط المناديب» off');
await get('sup',{from:'2026-11-19',to:'2026-11-19'},403);
eq((await inbox('sup')).role,'none','its card is gone');
sql.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_by,updated_at) VALUES('rep1','{}','[\"plans\"]',2,'owner',?)").run(created);
await get('rep1',{date:D},404);await send('rep1','2026-11-21',[stop('c1')],null,{},404);
eq((await inbox('rep1')).role,'none','a hidden screen has no card');
// GET /api/crm keeps the plans' audit rows out of its recent changes.
const snapshot=await call(crm.GET,{as:'owner',url:'https://test.invalid/api/crm'});
eq(snapshot.audits.filter(item=>String(item.action).startsWith('daily-plan:')).length,0,'no plan in the recent changes');
ok(audits().length>=12,'every write audited ('+audits().length+')');
// Nothing else changed: the plan never blocks recording (no other table refers to it).
eq(sql.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND sql LIKE '%daily_plan%'").all(),[],'no trigger');

console.log(JSON.stringify({ok:true,checks}));
