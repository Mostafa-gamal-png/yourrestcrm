// «خطة الغد» / «خطط المناديب» / «خطتي» after the port of GSCO 2.13.86 (2026-11-22; lib/daily-plans*.ts, lib/my-plan.ts), without a build:
// the plan due at 12:00 midnight at the start of its day, to the second, and the device's two hours of grace after it; a returned plan sent
// again after midnight is late, before it on time; the supervisor's window closing at that midnight (approve, edit and return 409, the note
// still open) and «غير معتمدة» from then on; the sales manager (and the administrator) acting until the plan's day ends and never after; who
// decided each stop and the targets, written in the review's audit line (`after.edits`) and read back with the plan; the member and the
// supervisor kept from what the sales manager decided (their stops, their place, a follow-up they took out, their targets, a return), with the
// message naming who; the sales manager's edit of an approved plan keeping the approval; the reminder card's 23:00 line for a supervisor and
// the sales manager's changes for the member and their supervisor, one notice for ten minutes; a review line written before the port reading
// as the supervisor's; the pure rules of «خطتي» (the banner, the stops in order, what a tap opens, a follow-up waiting on the device, the
// next midnight) and its page access. On an isolated in-memory SQLite, the route modules compiled as the build does, the session faked, the
// clock held at chosen Riyadh times. Synthetic people and factories only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'daily-plans-midnight-')),work=fs.mkdtempSync(path.join(os.tmpdir(),'yourrest-daily-plans-midnight-')),seen=new Set();
process.on('exit',()=>{fs.rmSync(out,{recursive:true,force:true});fs.rmSync(work,{recursive:true,force:true});});
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};

const RealDate=Date;let held=RealDate.parse('2026-11-30T09:00:00Z');
class HeldDate extends RealDate{constructor(...args){if(args.length)super(...args);else super(held);}static now(){return held;}}
globalThis.Date=HeldDate;
/** Riyadh wall clock 'YYYY-MM-DD HH:MM[:SS]' → the held instant. */
const at=wall=>{const text=wall.replace(' ','T');held=RealDate.parse(text+(text.length===16?':00':'')+'+03:00');return new RealDate(held).toISOString();};

function compile(relative){if(seen.has(relative))return;seen.add(relative);const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';compile(source);return 'from '+JSON.stringify(path.join(out,source.replace(/\.tsx?$/,'.mjs')));});fs.writeFileSync(dest,code);}
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const u=globalThis.testUser;if(!u)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version FROM crm_members WHERE user_id=?').bind(u.userId).first();return {...u,provider:'email-otp',memberId:m?.id||'missing',memberVersion:m?.auth_version};}`);
for(const name of ['daily-plans','daily-plans/inbox'])compile('app/api/'+name+'/route.ts');
for(const name of ['lib/daily-plans.ts','lib/my-plan.ts','lib/permissions.ts','lib/access.ts'])compile(name);
const load=name=>import(pathToFileURL(path.join(out,name)));
const R=await load('lib/daily-plans.mjs'),M=await load('lib/my-plan.mjs'),P=await load('lib/permissions.mjs'),A=await load('lib/access.mjs');

// ---- 1. Who decided what: the pure rules of the trail.
const stored=(id,customerId,supervisorState='',position=1,extra={})=>({id,position,customerId,kind:'visit',time:'',note:'',addedBy:'rep1',supervisorState,editedBy:supervisorState?'mgr':null,createdAt:'t',...extra});
const existing=[stored('s1','c1','',1),stored('s2','c2','',2),stored('s3','c3','',3)];
const after=[stored('s2','c2','',1),stored('s1','c1','edited',2,{time:'10:00'}),stored('n1','c4','added',3),stored('s3','c3','removed',4)];
eq(R.reviewerChanges(existing,after),{added:['n1'],edited:['s1'],removed:['s3'],order:true},'a reviewer\'s write: the stop added (by its new id), edited, taken out, and the order changed');
eq(R.reviewerChanges(existing,existing).order,false,'the same order: no move');
const line=(action,edits,extra={})=>({action:'daily-plan:'+action,at:'2026-12-01T05:00:00.000Z',actorName:'اسم mgr',detail:{before:{status:extra.before||'sent'},after:{version:extra.version||2,...(edits?{edits}:{})}}});
const editsOf=(by,extra={})=>({by,byId:by==='manager'?'mgr':'sup',added:[],edited:[],removed:[],order:false,targets:false,changed:false,...extra});
let trail=R.planEditTrail([line('approve_edited',editsOf('supervisor',{added:['n1'],changed:true})),line('approve_edited',editsOf('supervisor',{edited:['n1']}))]);
eq(trail.marks.get('n1'),{by:'supervisor',kind:'added'},'a stop the same person added and then edited stays «added» by them');
trail=R.planEditTrail([line('approve_edited',editsOf('supervisor',{added:['n1']})),line('approve_edited',editsOf('manager',{edited:['n1'],targets:true,changed:true}),{before:'approved_edited',version:5})]);
eq([trail.marks.get('n1'),trail.targets,trail.managerDecided,trail.manager],[{by:'manager',kind:'edited'},'manager',true,{byId:'mgr',byName:'اسم mgr',at:'2026-12-01T05:00:00.000Z',version:5,decision:'edit'}],'the sales manager\'s later edit decides, and an edit of an approved plan is an «edit»');
trail=R.planEditTrail([line('approve_edited',editsOf('manager',{added:['n2'],changed:true}))]);
eq(trail.manager.decision,'approve','with edits on a plan that waited: an approval');
eq(R.planEditTrail([line('return',editsOf('manager',{changed:true}))]).manager.decision,'return','a return');
eq(R.planEditTrail([line('approve',editsOf('manager'))]),{marks:new Map(),targets:null,managerDecided:true,manager:null},'a plain approval by the sales manager: theirs to decide, nothing to tell (no change)');
eq(R.planEditTrail([line('approve_edited',null),{action:'daily-plan:approve',at:'',actorName:'',detail:'not json'},{action:'daily-plan:approve',at:'',actorName:'',detail:null}]),{marks:new Map(),targets:null,managerDecided:false,manager:null},'a line written before 2026-11-22 (no edits), or one that cannot be read: nobody named');
eq([R.stopMark('',undefined),R.stopMark('edited',undefined),R.stopMark('added',{by:'supervisor',kind:'edited'}),R.stopMark('added',{by:'manager',kind:'edited'}),R.stopMark('removed',{by:'manager',kind:'edited'}),R.stopMark('edited',{by:'manager',kind:'removed'})],[null,{by:'supervisor',kind:'edited'},{by:'supervisor',kind:'added'},{by:'manager',kind:'edited'},{by:'manager',kind:'removed'},{by:'manager',kind:'edited'}],'the mark a stop shows: the stored state for the supervisor, the trail for the sales manager');
eq([R.stopMarkText('edited','manager'),R.stopMarkText('added','supervisor'),R.stopMarkText('removed',null)],[['عدّلها مدير المبيعات','Edited by the sales manager'],['أضافها المشرف','Added by the supervisor'],['حذفها المشرف','Removed by the supervisor']],'the words of a mark');
const managerTrail={marks:new Map([['m1',{by:'manager',kind:'edited'}],['m2',{by:'manager',kind:'removed'}]])};
const plan=[stored('a','c1','',1),stored('m1','c2','edited',2),stored('b','c3','',3),stored('m2','c5','removed',4)];
const wireOf=stop=>({id:stop.id,customerId:stop.customerId,kind:stop.kind,time:stop.time,note:stop.note});
const keepAll=plan.filter(stop=>stop.supervisorState!=='removed').map(wireOf);
eq(R.managerLockProblem(plan,keepAll,managerTrail),null,'the sales manager\'s stop sent back as it is: nothing refused');
eq(R.managerLockProblem(plan,[keepAll[0],{...keepAll[1],note:'تغيير'},keepAll[2]],managerTrail),'fixed','their stop changed');
eq(R.managerLockProblem(plan,[keepAll[0],keepAll[2]],managerTrail),'fixed','their stop taken out');
eq(R.managerLockProblem(plan,[...keepAll,{customerId:'c5',kind:'call',time:'',note:''}],managerTrail),'removed','a follow-up they took out brought back as a new stop');
eq(R.managerLockProblem(plan,[keepAll[1],keepAll[0],keepAll[2]],managerTrail),'order','a stop moved before theirs');
eq(R.managerLockProblem(plan,[keepAll[0],keepAll[1],{customerId:'c6',kind:'visit',time:'',note:''}],managerTrail),null,'the supervisor may drop the member\'s own stop after theirs and add another follow-up');
eq(R.managerLockProblem(plan,[keepAll[0],keepAll[1]],{marks:new Map()}),null,'no stop of the sales manager: nothing refused');
eq(R.removedBackProblems(plan,[...keepAll,{customerId:'c5',kind:'visit',time:'',note:''},{customerId:'c6',kind:'visit',time:'',note:''}]),[3],'the member: a follow-up a reviewer took out does not come back as a new stop');

// ---- 2. «خطتي»: the pure rules.
const view=(state,date='2026-12-01',extra={})=>({state,date,late:false,stops:[],...extra});
eq(['approved','approved_edited','sent','returned','draft','missing'].map(state=>M.myPlanBanner(view(state),'2026-12-01').key),['approved','approved_edited','unapproved','unapproved','draft','missing'],'today\'s plan: approved, «غير معتمدة» once its day began (sent or returned), a draft, none');
eq(['sent','returned'].map(state=>M.myPlanBanner(view(state,'2026-12-02'),'2026-12-01').key),['waiting','returned'],'a plan of a day not begun yet: waiting, returned');
eq([M.myPlanBanner(view('sent','2026-12-01',{late:true}),'2026-12-01').late,M.myPlanBanner(view('draft','2026-12-01',{late:true}),'2026-12-01').late,M.myPlanBanner(null,'2026-12-01').key],[true,false,'missing'],'«متأخرة» beside a plan sent late, never a draft; no plan');
eq(M.myPlanBanner(view('sent'),'2026-12-01').text,['غير معتمدة','Not approved'],'the words, Arabic and English');
const vs=(id,position,customerId,completion='open',supervisorState='')=>({id,position,customerId,completion,supervisorState});
eq(M.myPlanStops({stops:[vs('b',2,'c2'),vs('x',3,'c3','removed','removed'),vs('a',1,'c1')]}).map(stop=>stop.id),['a','b'],'the stops in their order, the one a reviewer took out left out');
eq(M.myPlanStops(null),[],'no plan, no stops');
const ids=new Set(['c1','c2']);
eq([M.stopTap(vs('a',1,'c1'),ids),M.stopTap(vs('b',2,'c2','done'),ids),M.stopTap(vs('b',2,'c2','done_other'),ids),M.stopTap(vs('c',3,'c9'),ids).kind],[{kind:'followup',customerId:'c1'},{kind:'customer',customerId:'c2'},{kind:'customer',customerId:'c2'},'gone'],'a tap: the follow-up of a stop not done, the customer of a done one, a message for one whose customer is gone');
eq(M.stopTap(vs('c',3,'c9'),ids).message,M.CUSTOMER_GONE,'the message of a customer gone');
eq([M.stopDoneText('done'),M.stopDoneText('done_other'),M.stopDoneText('open')],[['تمت','Done'],['تمت بطريقة تواصل أخرى','Done by another contact'],['لم تتم بعد','Not done yet']],'«تمت» on a done stop');
const records=[{id:'c1',kind:'customer',parentId:null,data:{name:'عميل'}},{id:'v1',kind:'activity',parentId:'c1',createdAt:'2026-11-30T22:00:00.000Z',data:{_offlineState:'pending',offlineRecordedAt:'2026-11-30T21:30:00.000Z'}},{id:'v2',kind:'activity',parentId:'c2',createdAt:'2026-11-30T05:00:00.000Z',data:{_offlineState:'pending',date:'2026-11-30'}},{id:'c2',kind:'customer',parentId:null,data:{name:'آخر'}},{id:'v3',kind:'activity',parentId:'c1',createdAt:'2026-12-01T05:00:00.000Z',data:{date:'2026-12-01'}}];
eq([M.queuedToday('c1',records,'2026-12-01'),M.queuedToday('c2',records,'2026-12-01'),M.queuedToday('c3',records,'2026-12-01')],[true,false,false],'a follow-up waiting on the device today (by its device time: 00:30 Riyadh); yesterday\'s or a synced one is not');
eq([M.msToRiyadhMidnight(RealDate.parse('2026-12-01T20:59:00.000Z')),M.msToRiyadhMidnight(RealDate.parse('2026-12-01T21:00:00.000Z')),M.msToRiyadhMidnight(RealDate.parse('2026-12-01T20:59:59.500Z'))],[60000,86400000,1000],'the next midnight in Riyadh (at least a second away)');
// The page: a field member's own, with «خطط المناديب» shown and «إعداد خطة اليوم» on.
const who=(role,cells={},hidden=[])=>({id:'x',role,access:P.memberAccess(role,{permissions:JSON.stringify(cells),hidden:JSON.stringify(hidden),version:1})});
eq(['rep','marketing','supervisor','manager','admin','customer_service'].map(role=>A.canViewPage(role,'my-plan')),[true,true,false,false,false,false],'«خطتي»: the field roles only');
eq([P.pageAllowed(who('rep'),'my-plan'),P.pageAllowed(who('rep',{},['plans']),'my-plan'),P.pageAllowed(who('rep',{'plans:add':false}),'my-plan'),P.pageAllowed(who('supervisor'),'my-plan'),P.pageAllowed(null,'my-plan')],[true,false,false,false,false],'hidden with «خطط المناديب», gone with «إعداد خطة اليوم» off, never a reviewer\'s');
eq([A.resolveCRMPage('rep','my-plan',[]),A.resolveCRMPage('rep','my-plan',['plans']),A.resolveCRMPage('supervisor','my-plan',[])],['my-plan','activity','activity'],'a bookmark of «خطتي» opens it, or the first page («الزيارات») when it is hidden or not the role\'s');

// ---- 3. The routes on an isolated database.
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const name of fs.readdirSync(path.join(root,'drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).sort())sql.exec(fs.readFileSync(path.join(root,'drizzle',name),'utf8'));
class Statement{constructor(q,a=[]){this.q=q;this.a=a;}bind(...a){return new Statement(this.q,a);}async run(){const r=sql.prepare(this.q).run(...this.a);return{meta:{changes:Number(r.changes)}};}async all(){return{results:sql.prepare(this.q).all(...this.a)};}async first(){return sql.prepare(this.q).get(...this.a)||null;}}
const DB={prepare:q=>new Statement(q),batch:async statements=>{sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(/^\s*(SELECT|WITH)/i.test(s.q)?{...await s.all(),meta:{changes:0}}:await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid'};
const created=new RealDate(held).toISOString();
const member=(id,role,supervisor=null,region='eastern')=>sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,1,0,?)').run(id,'u-'+id,id+'@yourrest.org','اسم '+id,role,'الرئيسي',supervisor,region,created);
member('owner','admin',null,'all');member('mgr','manager',null,'all');member('sup','supervisor','mgr');member('sup2','supervisor','mgr');
member('rep1','rep','sup');member('rep2','rep','sup');member('mk1','marketing','sup');member('rep3','rep','sup2');
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-owner')").run();
const record=(id,kind,parent,assigned,data,when=created)=>sql.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').run(id,kind,parent,assigned,'الرئيسي',JSON.stringify(data),when,when);
// Each customer has an open follow-up recorded on 2026-11-20 (before every plan day here, so it closes no stop).
for(const [id,owner] of [['c1','rep1'],['c2','rep1'],['c3','rep1'],['c4','rep1'],['c5','rep1'],['c6','rep1'],['d1','rep2'],['d2','rep2'],['m1','mk1'],['e1','rep3']]){
 record(id,'customer',null,owner,{name:'مصنع '+id,region:'الشرقية',city:'الدمام',location:'26.43, 50.03'});
 record('f-'+id,'activity',id,owner,{type:'call',date:'2026-11-20',summary:'متابعة سابقة',result:'تمت',performedBy:owner,responsibleId:owner,nextAction:'متابعة العرض',nextDate:'2026-12-01',visitWorkflow:'customer-v1'},'2026-11-20T07:00:00.000Z');
}
const user=id=>{globalThis.testUser=id?{userId:'u-'+id,email:id+'@yourrest.org',fullName:id}:null;};
const plans=await load('app/api/daily-plans/route.mjs'),inboxRoute=await load('app/api/daily-plans/inbox/route.mjs');
const call=async(handler,{as,body,url='https://test.invalid/api/daily-plans'},status=200)=>{
 user(as);const request=body===undefined?new Request(url):new Request(url,{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json'},body:JSON.stringify(body)});
 const response=await handler(request),data=await response.json();eq(response.status,status,(as||'anonymous')+' '+url+' '+JSON.stringify(body||'').slice(0,200)+' -> '+JSON.stringify(data).slice(0,300));return data;
};
const get=(as,query,status)=>call(plans.GET,{as,url:'https://test.invalid/api/daily-plans?'+new URLSearchParams(query)},status);
const post=(as,body,status)=>call(plans.POST,{as,body:{requestId:crypto.randomUUID(),...((body.action==='save'||body.action==='send')&&!('targets' in body)?{targets:{opportunities:1,customers:1}}:{}),...body}},status);
const send=(as,date,stops,baseVersion,extra={},status)=>post(as,{action:'send',date,stops,baseVersion,...extra},status);
const review=(as,action,memberId,date,baseVersion,extra={},status)=>post(as,{action,memberId,date,baseVersion,...extra},status);
const inbox=as=>call(inboxRoute.GET,{as,url:'https://test.invalid/api/daily-plans/inbox'});
const stop=(customerId,kind='visit',extra={})=>({customerId,kind,time:'',note:'',...extra});
const wire=item=>({id:item.id,customerId:item.customerId,kind:item.kind,time:item.time,note:item.note});
const marks=plan=>plan.stops.map(item=>[item.customerId,item.supervisorState,item.mark?item.mark.by+':'+item.mark.kind:null]);
const reviewLines=planId=>sql.prepare("SELECT action,detail FROM crm_audit WHERE record_id=? AND action IN ('daily-plan:approve','daily-plan:approve_edited','daily-plan:return') ORDER BY created_at,id").all(planId).map(row=>({action:row.action,detail:JSON.parse(row.detail)}));

// 3.1 The deadline to the second, and the device's two hours of grace. D1 is Tuesday 1 December: due at the midnight that ends Monday.
const D1='2026-12-01';
at('2026-11-30 23:59:59');
let saved=await send('rep1',D1,[stop('c1'),stop('c2','call'),stop('c3')],null);
eq([saved.plan.state,saved.plan.late,saved.plan.deadline,saved.plan.unapproved,saved.plan.reviewClosed],['sent',false,'2026-11-30T21:00:00.000Z',false,false],'sent at Monday 23:59:59: on time, the supervisor\'s window still open');
at('2026-12-01 00:00:00');
saved=await send('rep2',D1,[stop('d1')],null);
eq([saved.plan.late,saved.plan.unapproved],[true,true],'sent at Tuesday 00:00:00: late, and «غير معتمدة» at once (its day has begun)');
at('2026-12-01 01:59');
saved=await send('mk1',D1,[stop('m1')],null,{offline:{memberId:'mk1',capturedAt:'2026-11-30T20:30:00.000Z'}});
eq([saved.plan.late,saved.plan.firstSentAt,saved.plan.firstSentSource],[false,'2026-11-30T20:30:00.000Z','device'],'made on the device at Monday 23:30, received at 01:59 (within two hours of midnight): on time by the device\'s clock');
at('2026-12-01 02:00:01');
saved=await send('rep3',D1,[stop('e1')],null,{offline:{memberId:'rep3',capturedAt:'2026-11-30T20:30:00.000Z'}});
eq([saved.plan.late,saved.plan.firstSentAt,saved.plan.firstSentSource],[true,'2026-11-30T23:00:01.000Z','server'],'made before midnight, received at 02:00:01: the receipt, late');
eq(sql.prepare("SELECT json_extract(detail,'$.offline.crossedDeadline') v FROM crm_audit WHERE record_id='daily-plan:rep3:'||? AND action='daily-plan:send'").get(D1).v,1,'the audit line says the device\'s time crossed the deadline');

// 3.2 The supervisor's window closed at that midnight; the sales manager acts until the day ends.
at('2026-12-01 08:00');
let current=await get('sup',{date:D1,memberId:'rep2'});
eq([current.state,current.unapproved,current.reviewClosed,current.canApprove,current.canReviewEdit,current.canReturn,current.canNote,current.salesManager],['sent',true,true,false,false,false,true,false],'the supervisor reads «غير معتمدة»: no approval, edit or return any more; the note stays');
for(const [action,extra] of [['approve',{}],['approve_edited',{stops:current.stops.map(wire)}],['return',{reason:'تأخرت في الإرسال'}]])
 eq((await review('sup',action,'rep2',D1,current.version,extra,409)).error,R.PLAN_MESSAGES.reviewClosed,'the supervisor\'s '+action+' after midnight: 409');
eq((await review('sup','note','rep2',D1,undefined,{note:'نفّذها كما أرسلتها',noteVersion:null})).plan.myNote.note,'نفّذها كما أرسلتها','the supervisor\'s note on the day stays open');
eq((await get('sup',{date:D1})).rows.map(row=>[row.memberId,row.state,row.unapproved]),[['mk1','sent',true],['rep1','sent',true],['rep2','sent',true]],'the list: every plan of the day «غير معتمدة»');
eq([(await inbox('sup')).pending,(await inbox('sup')).salesManager],[[],false],'the supervisor\'s card: nothing waits for them any more');
const managerInbox=await inbox('mgr');
eq([managerInbox.pending.map(item=>item.memberId).sort(),managerInbox.salesManager],[['mk1','rep1','rep2','rep3'],true],'the sales manager\'s card: every plan of the day still waits for them');
current=await get('mgr',{date:D1,memberId:'rep1'});
eq([current.canApprove,current.canReviewEdit,current.canReturn,current.salesManager],[true,true,true,true],'the sales manager may still approve, edit and return');
const [c1,c2,c3]=current.stops;
saved=await review('mgr','approve_edited','rep1',D1,current.version,{stops:[{...wire(c1),time:'10:00'},wire(c2),stop('c4','call')],targets:{opportunities:3,customers:2}});
eq([saved.plan.state,saved.plan.unapproved,marks(saved.plan)],['approved_edited',false,[['c1','edited','manager:edited'],['c2','',null],['c4','added','manager:added'],['c3','removed','manager:removed']]],'approved with the sales manager\'s edits after midnight, each marked as theirs');
eq([saved.plan.targets,saved.plan.targetsEdited,saved.plan.targetsEditedBy,saved.plan.repTargets],[{opportunities:3,customers:2},true,'manager',{opportunities:1,customers:1}],'their targets, with the member\'s own kept');
eq([saved.plan.managerEdit.byName,saved.plan.managerEdit.decision,saved.plan.managerDecided,saved.plan.reviewedByName],['اسم mgr','approve',true,'اسم mgr'],'their change: an approval with edits, by them');
const added4=saved.plan.stops.find(item=>item.customerId==='c4');
eq(reviewLines('daily-plan:rep1:'+D1).at(-1).detail.after.edits,{by:'manager',byId:'mgr',added:[added4.id],edited:[c1.id],removed:[c3.id],order:false,targets:true,changed:true},'the audit line names who and what (after.edits)');
eq(marks(await get('rep1',{date:D1})),marks(saved.plan),'the member reads the same marks');
let card=await inbox('sup');
eq(card.edits.map(item=>[item.memberId,item.date,item.decision,item.byName]),[['rep1',D1,'approve','اسم mgr']],'the supervisor of the member hears of the sales manager\'s change');
eq(R.planReminderLines(card,held).filter(item=>item.tone==='manager').map(item=>item.key),['manager:rep1:'+D1+':'+R.managerNoticeSlot(saved.plan.managerEdit.at)],'one line for it');
eq((await inbox('rep1')).edits,[],'the member is told of the approval by its own line (their next day\'s card), not as an edit');
eq((await inbox('mgr')).edits,[],'the sales manager is never told of their own change');
// Their edits of an approved plan within ten minutes are one notice; later, another.
at('2026-12-01 08:01');
current=await get('mgr',{date:D1,memberId:'rep1'});
saved=await review('mgr','approve_edited','rep1',D1,current.version,{stops:current.stops.filter(item=>item.supervisorState!=='removed').map(item=>item.customerId==='c2'?{...wire(item),note:'أحضر العينة'}:wire(item))});
eq([saved.plan.managerEdit.decision,saved.plan.reviewedByName],['edit','اسم mgr'],'an edit of the approved plan: «edit», the approval kept');
const firstKey=R.planReminderLines(await inbox('rep1'),held).find(item=>item.tone==='manager').key;
at('2026-12-01 08:08');
current=await get('mgr',{date:D1,memberId:'rep1'});
saved=await review('mgr','approve_edited','rep1',D1,current.version,{stops:current.stops.filter(item=>item.supervisorState!=='removed').map(item=>item.customerId==='c2'?{...wire(item),note:'أحضر العينتين'}:wire(item))});
eq(R.planReminderLines(await inbox('rep1'),held).find(item=>item.tone==='manager').key,firstKey,'a second edit in the same ten minutes: the same notice');
at('2026-12-01 08:12');
current=await get('mgr',{date:D1,memberId:'rep1'});
saved=await review('mgr','approve_edited','rep1',D1,current.version,{stops:current.stops.filter(item=>item.supervisorState!=='removed').map(item=>item.customerId==='c2'?{...wire(item),time:'13:00'}:wire(item))});
ok(R.planReminderLines(await inbox('rep1'),held).find(item=>item.tone==='manager').key!==firstKey,'ten minutes later: a new notice');
// The day over: the sales manager no more either.
at('2026-12-02 00:00');
current=await get('mgr',{date:D1,memberId:'rep2'});
eq([current.canApprove,current.canReviewEdit,current.canReturn],[false,false,false],'the plan\'s day over: the sales manager may no longer act');
eq((await review('mgr','approve','rep2',D1,current.version,{},409)).error,R.PLAN_MESSAGES.past,'and is refused');

// 3.3 A returned plan sent again: before midnight on time, after it late. D2 is Wednesday 2 December.
const D2='2026-12-02';
at('2026-12-01 20:00');
const r1=await send('rep1',D2,[stop('c1')],null),r2=await send('rep2',D2,[stop('d1')],null);
eq([r1.plan.late,r2.plan.late],[false,false],'both sent on time');
at('2026-12-01 21:00');
await review('sup','return','rep2',D2,r2.plan.version,{reason:'أضف متابعة أخرى'});
at('2026-12-01 22:59');
card=await inbox('sup');
eq([card.pending.map(item=>item.memberId),R.planReminderLines(card,held).filter(item=>item.tone==='closing')],[['rep1'],[]],'22:59: one plan waits; no closing reminder yet');
at('2026-12-01 23:00');
saved=await send('rep2',D2,[stop('d1'),stop('d2','call')],r2.plan.version+1);
eq([saved.plan.state,saved.plan.late],['sent',false],'returned and sent again at 23:00, before midnight: on time');
at('2026-12-01 23:10');
card=await inbox('sup');
eq(R.planReminderLines(card,held).filter(item=>item.tone==='closing').map(item=>[item.key,item.count]),[['closing:'+D2,2]],'23:10: the closing reminder, two plans still waiting');
eq(R.planReminderLines(await inbox('mgr'),held).filter(item=>item.tone==='closing'),[],'never for the sales manager');
at('2026-12-01 23:30');
await review('sup','return','rep1',D2,r1.plan.version,{reason:'غيّر الترتيب'});
at('2026-12-02 00:05');
saved=await send('rep1',D2,[stop('c1'),stop('c2')],r1.plan.version+1);
eq([saved.plan.state,saved.plan.late,saved.plan.unapproved],['sent',true,true],'returned and sent again at 00:05, after midnight: late, and «غير معتمدة»');
eq(sql.prepare("SELECT json_extract(detail,'$.after.lateResend') v FROM crm_audit WHERE record_id='daily-plan:rep1:'||? AND action='daily-plan:send' ORDER BY created_at DESC,id DESC LIMIT 1").get(D2).v,1,'the audit line says why');

// 3.4 The sales manager's decisions stay theirs, before midnight too. D3 is Thursday 3 December.
const D3='2026-12-03';
at('2026-12-02 18:00');
saved=await send('rep1',D3,[stop('c1'),stop('c2'),stop('c3'),stop('c5')],null);
at('2026-12-02 18:10');
saved=await review('sup','approve','rep1',D3,saved.plan.version);
const approvedAt=saved.plan.reviewedAt;
at('2026-12-02 18:20');
current=await get('mgr',{date:D3,memberId:'rep1'});
let [p1,p2,p3,p5]=current.stops;
saved=await review('mgr','approve_edited','rep1',D3,current.version,{stops:[{...wire(p1),kind:'call'},wire(p2),wire(p5),stop('c4')],targets:{opportunities:3,customers:2}});
eq([saved.plan.state,saved.plan.reviewedByName,saved.plan.reviewedAt,saved.plan.managerEdit.decision],['approved_edited','اسم sup',approvedAt,'edit'],'the sales manager\'s edit of the supervisor\'s approval keeps it (who and when); their edit shows apart');
eq(saved.plan.stops.map(item=>[item.customerId,item.mark?.by||null]),[['c1','manager'],['c2',null],['c5',null],['c4','manager'],['c3','manager']],'their marks');
card=await inbox('rep1');
eq([card.next.date,card.edits.map(item=>[item.date,item.decision])],[D3,[[D3,'edit']]],'the member\'s card: the sales manager\'s edit of tomorrow\'s plan');
eq(R.planReminderLines(card,held).map(item=>item.tone),['manager'],'«عدّل مدير المبيعات خطتك», and not «اعتُمدت خطتك» again for that version');
at('2026-12-02 18:30');
current=await get('sup',{date:D3,memberId:'rep1'});
[p1,p2,p5]=current.stops;const p4=current.stops[3];
eq([current.canReviewEdit,current.canReturn,current.managerDecided],[true,false,true],'the supervisor may still edit before midnight, never return what the sales manager decided');
const supEdit=(stops,extra={},status=400)=>review('sup','approve_edited','rep1',D3,current.version,{stops,...extra},status);
eq((await supEdit([{...wire(p1),kind:'visit'},wire(p2),wire(p5),wire(p4)])).error,R.PLAN_MESSAGES.managerStopFixed,'the supervisor changing the sales manager\'s stop: refused');
eq((await supEdit([wire(p1),wire(p2),wire(p5)])).error,R.PLAN_MESSAGES.managerStopFixed,'taking out the sales manager\'s stop: refused');
eq((await supEdit([wire(p1),wire(p2),wire(p5),wire(p4),stop('c3')])).error,R.PLAN_MESSAGES.managerRemovedBack,'bringing back the follow-up the sales manager took out: refused');
eq((await supEdit([wire(p2),wire(p1),wire(p5),wire(p4)])).error,R.PLAN_MESSAGES.managerStopOrder,'moving a stop before theirs: refused');
eq((await supEdit([wire(p1),wire(p2),wire(p5),wire(p4)],{targets:{opportunities:1,customers:1}})).error,R.PLAN_MESSAGES.managerTargetsFixed,'changing their targets: refused');
eq((await review('sup','return','rep1',D3,current.version,{reason:'راجع الترتيب'},409)).error,R.PLAN_MESSAGES.managerDecidedReturn,'returning it: refused');
saved=await supEdit([wire(p1),wire(p2),{...wire(p5),note:'اتصل قبل الزيارة'},wire(p4)],{},200);
eq(saved.plan.stops.map(item=>[item.customerId,item.mark?item.mark.by+':'+item.mark.kind:null]),[['c1','manager:edited'],['c2',null],['c5','supervisor:edited'],['c4','manager:added'],['c3','manager:removed']],'the supervisor edits the member\'s own stop: theirs, the sales manager\'s kept');
eq(reviewLines('daily-plan:rep1:'+D3).at(-1).detail.after.edits.by,'supervisor','written as the supervisor\'s');
eq((await inbox('sup')).edits.filter(item=>item.date===D3).map(item=>item.decision),['edit'],'the supervisor is told of the sales manager\'s change, not of their own');
// The sales manager returns it; the member cannot undo what either reviewer decided.
at('2026-12-02 18:40');
saved=await review('mgr','return','rep1',D3,saved.plan.version,{reason:'أكد الموعد مع العميل'});
eq([saved.plan.state,saved.plan.managerEdit.decision],['returned','return'],'returned by the sales manager');
at('2026-12-02 18:45');
const live=saved.plan.stops.filter(item=>item.supervisorState!=='removed'),byCustomer=Object.fromEntries(live.map(item=>[item.customerId,item]));
const memberSend=(stops,extra={},status=403)=>send('rep1',D3,stops,saved.plan.version,{targets:{opportunities:3,customers:2},...extra},status);
eq((await memberSend([wire(byCustomer.c1),wire(byCustomer.c2),wire(byCustomer.c5)])).error,R.PLAN_MESSAGES.lockedManager,'the member deleting the sales manager\'s stop: refused, naming the sales manager');
eq((await memberSend([{...wire(byCustomer.c1),time:'08:00'},wire(byCustomer.c2),wire(byCustomer.c5),wire(byCustomer.c4)])).error,R.PLAN_MESSAGES.lockedManager,'changing it: refused');
eq((await memberSend([wire(byCustomer.c1),wire(byCustomer.c2),{...wire(byCustomer.c5),note:''},wire(byCustomer.c4)])).error,R.PLAN_MESSAGES.locked,'changing the supervisor\'s: refused, naming the supervisor');
eq((await memberSend([wire(byCustomer.c1),wire(byCustomer.c2),wire(byCustomer.c5),wire(byCustomer.c4),stop('c3')])).error,R.PLAN_MESSAGES.removedBack,'bringing back the follow-up a reviewer took out, as a new stop: refused');
eq((await memberSend([wire(byCustomer.c1),wire(byCustomer.c2),wire(byCustomer.c5),wire(byCustomer.c4)],{targets:{opportunities:1,customers:1}})).error,R.PLAN_MESSAGES.targetsFixedManager,'changing the sales manager\'s targets: refused');
saved=await memberSend([wire(byCustomer.c4),wire(byCustomer.c1),wire(byCustomer.c2),wire(byCustomer.c5),stop('c6')],{},200);
eq([saved.plan.state,saved.plan.late,saved.plan.stops.map(item=>item.customerId)],['sent',false,['c4','c1','c2','c5','c6','c3']],'sent again with their stops as they are (in another order) and a follow-up of the member\'s own');
// Their targets set back to the member's own numbers stay theirs.
at('2026-12-02 18:50');
saved=await review('mgr','approve_edited','rep1',D3,saved.plan.version,{stops:saved.plan.stops.filter(item=>item.supervisorState!=='removed').map(wire),targets:{opportunities:1,customers:1}});
eq([saved.plan.targets,saved.plan.targetsEdited,saved.plan.targetsEditedBy,saved.plan.repTargets],[{opportunities:1,customers:1},true,'manager',null],'set back to the member\'s numbers: still the sales manager\'s');
at('2026-12-02 18:55');
saved=await review('mgr','return','rep1',D3,saved.plan.version,{reason:'أضف متابعة'});
eq((await send('rep1',D3,saved.plan.stops.filter(item=>item.supervisorState!=='removed').map(wire),saved.plan.version,{targets:{opportunities:5,customers:5}},403)).error,R.PLAN_MESSAGES.targetsFixedManager,'the member cannot change them');
saved=await send('rep1',D3,saved.plan.stops.filter(item=>item.supervisorState!=='removed').map(wire),saved.plan.version,{targets:{opportunities:1,customers:1}});
eq(saved.plan.state,'sent','sent with them');
eq(sql.prepare("SELECT targets_edited FROM crm_daily_plan_targets WHERE plan_id='daily-plan:rep1:'||?").get(D3).targets_edited,0,'the stored row is unmarked (the lock is the audit line\'s)');

// 3.5 A review line written before the port (no `edits`) reads as the supervisor's.
sql.prepare("UPDATE crm_audit SET detail=json_remove(detail,'$.after.edits') WHERE record_id='daily-plan:rep1:'||?").run(D1);
current=await get('rep1',{date:D1});
eq([marks(current),current.targetsEditedBy,current.managerEdit,current.managerDecided],[[['c1','edited','supervisor:edited'],['c2','edited','supervisor:edited'],['c4','added','supervisor:added'],['c3','removed','supervisor:removed']],'supervisor',null,false],'every mark the supervisor\'s, as before the port');

// Every refusal of the plans has its English (lib/locales/en.json), the ones of 2026-11-22 included.
const english=JSON.parse(fs.readFileSync(path.join(root,'lib/locales/en.json'),'utf8'));
eq(Object.entries(R.PLAN_MESSAGES).filter(([,text])=>!english[text]).map(([key])=>key),[],'every plan message has its English');
eq(['reviewClosed','lockedManager','removedBack','targetsFixedManager','managerStopFixed','managerRemovedBack','managerStopOrder','managerTargetsFixed','managerDecidedReturn'].map(key=>/[\u0600-\u06ff]/.test(english[R.PLAN_MESSAGES[key]])),Array(9).fill(false),'and the English holds no Arabic');

console.log(JSON.stringify({ok:true,checks}));
