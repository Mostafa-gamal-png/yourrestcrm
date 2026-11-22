// «خطة الغد» / «خطط المناديب» and the bulk move of follow-ups (lib/daily-plans.ts, lib/daily-plans-server.ts, lib/followup-next-dates-server.ts),
// for the cases an independent mutation review (2026-11-22) found no test held, on an isolated in-memory SQLite with every migration (the
// route modules compiled as the build does, the session faked, the clock held at chosen Riyadh times):
// - the device's clock a few seconds ahead of the server's (within the minute it is trusted), and a stop of a customer whose other stop a
//   reviewer took out, sent back by its own id;
// - a supervisor's decision while the representative moves to another supervisor (the commit's team check), the reviewer's note and its
//   seven days (the route and the plan's canNote), a stop a reviewer adds for a customer outside the member's regions;
// - the sales manager's reminder card: their own changes never announced to themselves, another sales manager's changes only for the members
//   who report to them;
// - a returned plan sent again after the deadline with other targets (late as a resend, not as a change of targets);
// - a customer-service registration of the member's day, which is no visit of the plan; an imported opportunity, which is no achievement;
// - a representative moving the follow-up date of a visit they recorded on another representative's customer.
// Synthetic people and factories only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'daily-plans-server-unit-')),seen=new Set();
process.on('exit',()=>{fs.rmSync(out,{recursive:true,force:true});});
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};

const RealDate=Date;let held=RealDate.parse('2026-11-18T09:00:00Z');
class HeldDate extends RealDate{constructor(...args){if(args.length)super(...args);else super(held);}static now(){return held;}}
globalThis.Date=HeldDate;
/** Riyadh wall clock 'YYYY-MM-DD HH:MM' → the held instant. */
const at=wall=>{held=RealDate.parse(wall.replace(' ','T')+':00+03:00');return new RealDate(held).toISOString();};

function compile(relative){if(seen.has(relative))return;seen.add(relative);const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';compile(source);return 'from '+JSON.stringify(path.join(out,source.replace(/\.tsx?$/,'.mjs')));});fs.writeFileSync(dest,code);}
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=new Proxy({},{get:(_,key)=>globalThis.testEnv?.[key]});');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const u=globalThis.testUser;if(!u)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version FROM crm_members WHERE user_id=?').bind(u.userId).first();return {...u,provider:'email-otp',memberId:m?.id||'missing',memberVersion:m?.auth_version};}`);
for(const name of ['daily-plans','daily-plans/inbox','crm/opportunity-next-dates'])compile('app/api/'+name+'/route.ts');
for(const name of ['lib/daily-plans.ts','lib/daily-plans-server.ts'])compile(name);
const load=name=>import(pathToFileURL(path.join(out,name)));
const R=await load('lib/daily-plans.mjs'),PS=await load('lib/daily-plans-server.mjs');

// ---- 1. The rules alone.
const received='2026-11-20T08:00:00.000Z',ahead=seconds=>new RealDate(RealDate.parse(received)+seconds*1000).toISOString();
eq(R.planSentAt({capturedAt:ahead(30),receivedAt:received},received),{at:ahead(30),source:'device'},'the device\'s clock 30 seconds ahead of the server: trusted');
eq(R.planSentAt({capturedAt:ahead(60),receivedAt:received},received).source,'device','a minute ahead exactly: trusted');
eq(R.planSentAt({capturedAt:ahead(61),receivedAt:received},received).source,'server','a minute and a second ahead: the receipt');
const kept=(id,customerId,supervisorState='')=>({id,position:1,customerId,kind:'visit',time:'',note:'',addedBy:'rep1',supervisorState,editedBy:supervisorState?'sup':null,createdAt:received});
const existing=[kept('s1','c1'),{...kept('s2','c1','removed'),position:2}];
eq(R.removedBackProblems(existing,[{id:'s1',customerId:'c1',kind:'visit',time:'',note:''}]),[],'the member\'s own stop of a customer whose OTHER stop the reviewer took out, sent back by its id: allowed');
eq(R.removedBackProblems(existing,[{customerId:'c1',kind:'call',time:'',note:''}]),[0],'a new stop on that customer: refused');

// ---- 2. The database and the routes.
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const name of fs.readdirSync(path.join(root,'drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).sort())sql.exec(fs.readFileSync(path.join(root,'drizzle',name),'utf8'));
class Statement{constructor(q,a=[]){this.q=q;this.a=a;}bind(...a){return new Statement(this.q,a);}async run(){const r=sql.prepare(this.q).run(...this.a);return{meta:{changes:Number(r.changes)}};}async all(){return{results:sql.prepare(this.q).all(...this.a)};}async first(){return sql.prepare(this.q).get(...this.a)||null;}}
let race=null;
const DB={prepare:q=>new Statement(q),batch:async statements=>{if(race){const fn=race;race=null;await fn();}sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(/^\s*(SELECT|WITH)/i.test(s.q)?{...await s.all(),meta:{changes:0}}:await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid'};
const created=new RealDate(held).toISOString();
const member=(id,role,supervisor=null,region='eastern')=>sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,1,0,?)').run(id,'u-'+id,id+'@yourrest.org','اسم '+id,role,'الرئيسي',supervisor,region,created);
member('owner','admin',null,'all');member('mgr','manager',null,'all');member('mgr2','manager',null,'all');member('sup','supervisor','mgr');member('sup2','supervisor','mgr');
member('rep1','rep','sup');member('rep2','rep','sup2');member('rep3','rep','mgr');member('west','rep','sup','western');
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-owner')").run();
const record=(id,kind,parent,assigned,data,when=created)=>sql.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').run(id,kind,parent,assigned,'الرئيسي',JSON.stringify(data),when,when);
const followup=(customerId,owner)=>record('f-'+customerId,'activity',customerId,owner,{type:'call',date:'2026-11-16',summary:'متابعة سابقة',result:'تمت',performedBy:owner,responsibleId:owner,nextAction:'متابعة العرض',nextDate:'2026-11-19',visitWorkflow:'customer-v1'},'2026-11-16T07:00:00.000Z');
for(const [id,owner] of [['c1','rep1'],['c2','rep1'],['r2','rep2'],['r3','rep3']]){record(id,'customer',null,owner,{name:'مصنع '+id,region:'الشرقية',city:'الدمام',location:'26.43, 50.03'});followup(id,owner);}
record('cW','customer',null,'west',{name:'مصنع الغرب',region:'الغربية',city:'جدة',location:'21.5, 39.2'});followup('cW','west');
const user=id=>{globalThis.testUser=id?{userId:'u-'+id,email:id+'@yourrest.org',fullName:id}:null;};
const plans=await load('app/api/daily-plans/route.mjs'),inboxRoute=await load('app/api/daily-plans/inbox/route.mjs'),nextDates=await load('app/api/crm/opportunity-next-dates/route.mjs');
const call=async(handler,{as,body,url='https://test.invalid/api/daily-plans'},status=200)=>{
 user(as);const request=body===undefined?new Request(url):new Request(url,{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json'},body:JSON.stringify(body)});
 const response=await handler(request),data=await response.json();eq(response.status,status,(as||'anonymous')+' '+url+' '+JSON.stringify(body||'').slice(0,160)+' -> '+JSON.stringify(data).slice(0,300));return data;
};
const get=(as,query,status)=>call(plans.GET,{as,url:'https://test.invalid/api/daily-plans?'+new URLSearchParams(query)},status);
const TARGETS={opportunities:0,customers:0};
const post=(as,body,status)=>call(plans.POST,{as,body:{requestId:crypto.randomUUID(),...((body.action==='save'||body.action==='send')&&!('targets' in body)?{targets:TARGETS}:{}),...body}},status);
const stop=(customerId,kind='visit',extra={})=>({customerId,kind,time:'',note:'',...extra});
const send=(as,date,stops,baseVersion,extra={},status)=>post(as,{action:'send',date,stops,baseVersion,...extra},status);
const review=(as,action,memberId,date,baseVersion,extra={},status)=>post(as,{action,memberId,date,baseVersion,...extra},status);
const inbox=as=>call(inboxRoute.GET,{as,url:'https://test.invalid/api/daily-plans/inbox'});
const D='2026-11-19';// Thursday; due at midnight at its start (2026-11-18 21:00 UTC).

at('2026-11-18 20:00');
// The supervisor's decision while the representative is moved to another supervisor between the read and the commit: refused, nothing changed.
let plan=(await send('rep1',D,[stop('c1')],null)).plan;
race=()=>sql.prepare("UPDATE crm_members SET supervisor_id='sup2' WHERE id='rep1'").run();
await review('sup','approve','rep1',D,plan.version,{},409);
eq({...sql.prepare("SELECT status,version FROM crm_daily_plans WHERE member_id='rep1' AND date=?").get(D)},{status:'sent',version:plan.version},'moved to another supervisor at the commit: the approval is not written');
sql.prepare("UPDATE crm_members SET supervisor_id='sup' WHERE id='rep1'").run();

// A stop a reviewer adds for a customer outside the member's regions: refused as such (403), before anything else.
await review('mgr','approve_edited','rep1',D,plan.version,{stops:[{id:plan.stops[0].id,customerId:'c1',kind:'visit',time:'',note:''},stop('cW')],targets:TARGETS},403);

// The reviewer's note: up to seven days ahead (the route and the plan's canNote).
const D7='2026-11-25',D8='2026-11-26';
eq([(await get('sup',{date:D7,memberId:'rep1'})).canNote,(await get('sup',{date:D8,memberId:'rep1'})).canNote],[true,false],'canNote: seven days ahead yes, the eighth no');
await review('sup','note','rep1',D7,undefined,{note:'خطة الأسبوع القادم',noteVersion:null});
await review('sup','note','rep1',D8,undefined,{note:'بعد ثمانية أيام',noteVersion:null},400);

// A returned plan sent again after the deadline with other targets: late as a resend, not marked as a change of the targets.
plan=(await review('sup','return','rep1',D,plan.version,{reason:'أضف زيارات'})).plan;
at('2026-11-19 08:00');
plan=(await send('rep1',D,[{id:plan.stops[0].id,customerId:'c1',kind:'visit',time:'',note:''}],plan.version,{targets:{opportunities:2,customers:1}})).plan;
eq([plan.state,plan.late],['sent',true],'sent again after the deadline: late');
const detail=JSON.parse(sql.prepare("SELECT detail FROM crm_audit WHERE record_id=? AND action='daily-plan:send' ORDER BY created_at DESC,id DESC LIMIT 1").get(PS.planId('rep1',D)).detail);
eq([detail.after.lateResend,detail.after.lateTargets],[true,undefined],'the audit says a late resend, not a late change of the targets');

// A customer-service registration on the member's day is no visit of the plan.
record('svc-1','activity','c2','rep1',{type:'visit',date:D,summary:'طلب خدمة',performedBy:'rep1',responsibleId:'rep1',visitWorkflow:'service-intake-v1'},'2026-11-19T05:00:00.000Z');
plan=await get('rep1',{date:D});
eq([plan.counts.outside,plan.activities.length],[0,0],'the registration is neither outside the plan nor an activity of it');

// ---- 3. The sales manager's reminder card (GSCO 2.13.86): their own changes are not announced to themselves; another sales manager's are,
// for the members who report to them only.
at('2026-11-19 20:00');
const E='2026-11-20';
const approvedPlan=async memberId=>{const customer=memberId==='rep3'?'r3':'c1';const sent=(await send(memberId,E,[stop(customer)],null)).plan;return (await review('mgr','approve',memberId,E,sent.version)).plan;};
const edit=async(as,memberId,current,time)=>(await review(as,'approve_edited',memberId,E,current.version,{stops:current.stops.map(s=>({id:s.id,customerId:s.customerId,kind:s.kind,time,note:s.note})),targets:TARGETS})).plan;
let three=await approvedPlan('rep3'),one=await approvedPlan('rep1');
three=await edit('mgr','rep3',three,'09:00');
eq((await inbox('mgr')).edits,[],'the sales manager\'s own change of their representative\'s plan: not announced to them');
one=await edit('mgr2','rep1',one,'10:00');
eq((await inbox('mgr')).edits.map(item=>item.memberId),[],'another sales manager\'s change of a member who reports to a supervisor: not on this manager\'s card');
eq((await inbox('sup')).edits.map(item=>[item.memberId,item.byName]),[['rep1','اسم mgr2']],'it is on the supervisor\'s card');
at('2026-11-19 20:05');// a later line than the manager's own (the trail is read oldest first)
three=await edit('mgr2','rep3',three,'11:00');
eq((await inbox('mgr')).edits.map(item=>[item.memberId,item.byName,item.decision]),[['rep3','اسم mgr2','edit']],'another sales manager\'s change of a member who reports to this manager: on their card');

// ---- 4. The day's achievements: an opportunity imported from a file is no new opportunity of the member.
const opportunity=(id,extra)=>({id,kind:'opportunity',parentId:'c1',assignedTo:'rep1',branch:'الرئيسي',data:{hasRequest:true,stage:'new',_createdBy:'rep1',...extra},createdAt:'2026-11-19T06:00:00.000Z',updatedAt:'2026-11-19T06:00:00.000Z',version:1});
const members=sql.prepare('SELECT id,email,name,role FROM crm_members').all();
eq(PS.planActuals({all:[opportunity('o1',{}),opportunity('o2',{sourceFile:'import.xlsx'})],members},['rep1'],'2026-11-19').get('rep1'),{opportunities:1,customers:0},'the imported opportunity is not counted');

// ---- 5. POST /api/crm/opportunity-next-dates: a representative moves only the follow-ups of their own customers, even one they recorded.
record('v-other','activity','r2','rep2',{type:'visit',date:'2026-11-19',summary:'زيارة لعميل زميل',result:'تمت',performedBy:'rep1',responsibleId:'rep1',nextAction:'اتصال',nextDate:'2026-11-22',visitWorkflow:'customer-v1'},'2026-11-19T07:00:00.000Z');
const moved=await call(nextDates.POST,{as:'rep1',url:'https://test.invalid/api/crm/opportunity-next-dates',body:{request_id:crypto.randomUUID(),next_date:'2026-11-24',items:[{id:'v-other',version:1}]}});
eq(moved.results.map(result=>[result.id,result.status]),[['v-other','not_found']],'another representative\'s customer: not found, even for a visit of their own');
eq(JSON.parse(sql.prepare("SELECT data FROM crm_records WHERE id='v-other'").get().data).nextDate,'2026-11-22','and the date did not move');

console.log(JSON.stringify({ok:true,checks}));
