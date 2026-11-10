// «فريقي النهارده» (lib/team-today*.ts, GET /api/team-today; the owner 2026-11-10, item 4): the pure rules (the start of the day, the
// order, the totals, what the page accepts), then the route and the reader on an isolated in-memory SQLite (every drizzle migration; the
// route compiled as the build does, the session faked): 401 anonymous, 403 a representative and customer service, 404 when «تقرير يوم
// المندوب» is hidden; each reader's rows are exactly the day report's people (the supervisor's own representatives in their region, the
// manager's and the administrator's wider, «عرض بيانات الفريق بالكامل» widening it read only, never the reader, an inactive member or
// another region's); visits and other contacts counted by the day in Riyadh time around midnight; the start from the first observed
// movement (a phone's tracking day or the customer's route) or the first record; the unread notes over the inbox window, a read
// version and an edited one. Synthetic people only; no build, no network, no production data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'team-today-')),seen=new Set();
process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};
function compile(relative){if(seen.has(relative))return;seen.add(relative);const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';compile(source);return 'from '+JSON.stringify(path.join(out,source.replace(/\.tsx?$/,'.mjs')));});fs.writeFileSync(dest,code);}
// The environment is read when a request comes, so the modules can be imported before the database exists.
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=new Proxy({},{get:(_,key)=>globalThis.testEnv?.[key]});');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const u=globalThis.testUser;if(!u)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version FROM crm_members WHERE user_id=?').bind(u.userId).first();return {...u,provider:'email-otp',memberId:m?.id||'missing',memberVersion:m?.auth_version};}`);
compile('app/api/team-today/route.ts');compile('app/api/journeys/route.ts');compile('lib/crm-server.ts');
const rules=await import(pathToFileURL(path.join(out,'lib/team-today.mjs')));
const route=await import(pathToFileURL(path.join(out,'app/api/team-today/route.mjs'))),journeys=await import(pathToFileURL(path.join(out,'app/api/journeys/route.mjs')));
const server=await import(pathToFileURL(path.join(out,'lib/team-today-server.mjs')));
const crmServer=await import(pathToFileURL(path.join(out,'lib/crm-server.mjs')));

// ---- 1. The pure rules.
eq(rules.dayStart(null,null),{startedAt:null,startedBy:null},'neither a movement nor a record: not started');
eq(rules.dayStart('2026-03-03T05:01:00.000Z','2026-03-03T05:30:00.000Z'),{startedAt:'2026-03-03T05:01:00.000Z',startedBy:'movement'},'the earlier: the first movement');
eq(rules.dayStart('2026-03-03T06:11:00.000Z','2026-03-03T06:00:00.000Z'),{startedAt:'2026-03-03T06:00:00.000Z',startedBy:'record'},'the earlier: the first record');
eq(rules.dayStart(null,'2026-03-03T06:00:00.000Z').startedBy,'record','a record alone (no tracking: a supervisor in a browser)');
eq(rules.dayStart('not a time',''),{startedAt:null,startedBy:null},'unreadable times are nothing');
const row=(memberId,name,visits,contacts,startedAt,unreadNotes=0)=>({memberId,name,role:'rep',visits,contacts,startedAt,startedBy:startedAt?'record':null,unreadNotes});
const sorted=rules.sortTeamToday([row('a','ب',5,0,'x'),row('b','أ',0,0,null),row('c','ج',1,0,'x'),row('d','د',0,2,'x'),row('e','ه',0,0,'x'),row('f','و',3,0,null)]);
eq(sorted.map(r=>r.memberId),['b','f','e','d','c','a'],'not started first (fewest visits first among them), then the fewest visits, then the fewest other contacts');
eq(rules.teamTodayTotals([row('a','أ',2,1,'x',1),row('b','ب',0,0,null,2),row('c','ج',1,3,'x',0)]),{members:3,started:2,visits:3,contacts:4,unreadNotes:3},'the header totals');
eq(rules.teamTodayTotals([]),{members:0,started:0,visits:0,contacts:0,unreadNotes:0},'an empty team');
const body={ok:true,date:'2026-03-03',serverTime:'2026-03-03T09:00:00.000Z',workingDay:true,windowStartsAt:'2026-03-03T03:00:00.000Z',rows:[row('a','أ',1,0,'2026-03-03T05:00:00.000Z')],totals:{members:1,started:1,visits:1,contacts:0,unreadNotes:0}};
eq([rules.validTeamToday(body),rules.validTeamToday({...body,ok:false}),rules.validTeamToday({...body,rows:[{...body.rows[0],visits:-1}]}),rules.validTeamToday({...body,rows:[{...body.rows[0],startedBy:'x'}]}),rules.validTeamToday(null)],[true,false,false,false,false],'the page accepts only a well-formed answer');
eq([rules.TEAM_TODAY_INTERVAL_MS,rules.TEAM_TODAY_FOCUS_MS],[300000,60000],'every 5 minutes, on focus at most once a minute');

// ---- 2. The route and the reader on an isolated database.
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const name of fs.readdirSync(path.join(root,'drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).sort())sql.exec(fs.readFileSync(path.join(root,'drizzle',name),'utf8'));
class Statement{constructor(q,a=[]){this.q=q;this.a=a;}bind(...a){return new Statement(this.q,a);}async run(){const r=sql.prepare(this.q).run(...this.a);return{meta:{changes:Number(r.changes)}};}async all(){return{results:sql.prepare(this.q).all(...this.a).map(row=>({...row}))};}async first(){const row=sql.prepare(this.q).get(...this.a);return row?{...row}:null;}}
const DB={prepare:q=>new Statement(q),batch:async statements=>{sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid'};
const now=new Date().toISOString(),today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const yesterday=new Date(Date.parse(today+'T12:00:00Z')-86400000).toISOString().slice(0,10);
const member=(id,role,supervisor=null,region='eastern',active=1)=>sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,?,0,?)').run(id,'u-'+id,id+'@yourrest.org','اسم '+id,role,'الرئيسي',supervisor,region,active,'2026-01-01T00:00:00.000Z');
member('owner','admin',null,'all');member('mgr','manager',null,'all');member('sup','supervisor','mgr');member('sup2','supervisor','mgr');member('suph','supervisor','mgr');
member('rep1','rep','sup');member('rep2','rep','sup');member('rep4','rep','sup');member('repw','rep','sup','western');member('gone','rep','sup','eastern',0);
member('rep3','rep','sup2');member('cs','customer_service','mgr');member('csm','customer_service_manager','mgr');
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-owner')").run();
sql.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_at,updated_by) VALUES('suph','{}','[\"journeys\"]',1,?,'owner')").run(now);
const record=(id,kind,parent,assigned,data,at=now)=>sql.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').run(id,kind,parent,assigned,'الرئيسي',JSON.stringify(data),at,at);
record('c1','customer',null,'rep1',{name:'مصنع الشرق',region:'الشرقية',city:'الدمام',location:'26.43, 50.03',customerStatus:'نشط'});
record('cw','customer',null,'repw',{name:'مصنع الغرب',region:'الغربية',city:'جدة',location:'21.5, 39.2',customerStatus:'نشط'});
const activity=(id,by,{type='visit',date=today,customer='c1',at=now,extra={}}={})=>record(id,'activity',customer,by,{type,...(date===null?{}:{date}),summary:'تعريف',result:'تمت',performedBy:by,responsibleId:by,recordedByEmail:by+'@yourrest.org',...extra},at);
// Today: rep1 two visits and a call; rep3 (another team) one visit; the supervisor one visit; the western representative one.
activity('t-rep1-v1','rep1');activity('t-rep1-v2','rep1');activity('t-rep1-call','rep1',{type:'call'});activity('t-rep3','rep3');activity('t-sup','sup');activity('t-repw','repw',{customer:'cw'});
activity('y-rep2','rep2',{date:yesterday});
// The notes: rep1's visit unread, rep1's day read at the version noted; rep2's day of yesterday unread, an edited note read only at its
// first version, and one older than the window.
const old=new Date(Date.now()-31*86400000).toISOString();
const entryNote=(activityId,memberId,version,at=now)=>sql.prepare('INSERT INTO crm_daily_entry_reviews(activity_id,member_id,date,result,action,reviewed_by,version,mutation_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(activityId,memberId,today,'نتيجة','إجراء','sup',version,'m-'+activityId,at,at);
const dayNote=(memberId,date,version,at=now)=>sql.prepare('INSERT INTO crm_daily_report_reviews(member_id,date,result,action,reviewed_by,version,mutation_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(memberId,date,'نتيجة','إجراء','sup',version,'d-'+memberId+date,at,at);
const readRow=id=>sql.prepare("INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES(?,'x','اسم','قراءة مراجعة المشرف','{}',?)").run(id,now);
entryNote('t-rep1-v1','rep1',1);dayNote('rep1',today,2);readRow('review-read:day:rep1:'+today+':2');
dayNote('rep2',yesterday,1);activity('y-rep2-b','rep2',{date:yesterday});entryNote('y-rep2-b','rep2',2);readRow('review-read:entry:y-rep2-b:1');
activity('old-rep2','rep2',{date:yesterday});entryNote('old-rep2','rep2',1,old);

const as=id=>{globalThis.testUser=id?{userId:'u-'+id,email:id+'@yourrest.org',fullName:id}:null;};
const get=async(id,status=200)=>{as(id);const response=await route.GET(new Request('https://test.invalid/api/team-today')),data=await response.json();eq(response.status,status,(id||'anonymous')+' GET /api/team-today -> '+JSON.stringify(data).slice(0,200));if(status===200)eq(response.headers.get('cache-control'),'no-store','never cached');return data;};
const shape=data=>data.rows.map(row=>[row.memberId,row.visits,row.contacts,row.startedBy,row.unreadNotes]);

// The doors.
eq((await get(null,401)).error,'سجّل الدخول للوصول إلى التطبيق.','anonymous: 401');
for(const id of ['rep1','rep4'])eq((await get(id,403)).error,'تقرير خط السير متاح للمشرف ومدير المبيعات فقط','a representative: 403, the day report\'s own refusal ('+id+')');
for(const id of ['cs','csm'])eq((await get(id,403)).error,'هذا الإجراء متاح لفريق المبيعات فقط','customer service: 403 ('+id+')');
eq((await get('suph',404)).error,'هذا الجزء غير متاح لحسابك. راجع مدير النظام.','«تقرير يوم المندوب» hidden from a supervisor: 404, like the report');

// The supervisor: their three active eastern representatives; not rep3 (another team), not the western one, not the inactive one,
// not themself (although they visited).
let data=await get('sup');
eq(shape(data),[['rep2',0,0,null,2],['rep4',0,0,null,0],['rep1',2,1,'record',1]],'the supervisor: not started first (rep2, rep4), then rep1 with two visits, a call and the record that started the day; the unread notes');
eq([data.date,data.totals],[today,{members:3,started:1,visits:2,contacts:1,unreadNotes:3}],'today in Riyadh, and the header totals');
ok(Object.keys(data.rows[0]).sort().join()===['contacts','memberId','name','role','startedAt','startedBy','unreadNotes','visits'].join(),'a row carries names, counts and times only');
const first=data.rows.find(r=>r.memberId==='rep1').startedAt;
eq(first,now,'rep1 started when the first of today\'s records was stored');
eq(rules.validTeamToday(data),true,'the page accepts the answer');
// The manager and the administrator: every active representative, and the supervisor who visited; never the reader.
data=await get('mgr');
eq(shape(data).map(r=>r[0]),['rep2','rep4','rep3','repw','sup','rep1'],'the sales manager: every active representative (both regions) and the supervisor who visited');
eq(shape(data).find(r=>r[0]==='sup'),['sup',1,0,'record',0],'the supervisor\'s own visit, for their manager');
eq(data.rows.find(r=>r.memberId==='sup').role,'supervisor','named by role');
data=await get('owner');
eq(shape(data).map(r=>r[0]),['rep2','rep4','rep3','repw','sup','rep1'],'the administrator: the same people (nobody else did anything today)');
eq(data.totals,{members:6,started:4,visits:5,contacts:1,unreadNotes:3},'the administrator\'s totals');
// «عرض بيانات الفريق بالكامل»: the supervisor reads every sales member's day in their region, read only.
sql.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_at,updated_by) VALUES('sup','{\"viewAll\":true}','[]',1,?,'owner')").run(now);
data=await get('sup');
eq(shape(data).map(r=>r[0]),['rep2','rep4','rep3','rep1'],'«عرض بيانات الفريق بالكامل»: another supervisor\'s representative too, still only in their region');
eq(shape(data).find(r=>r[0]==='rep3'),['rep3',1,0,'record',0],'with their visit');
sql.prepare("DELETE FROM crm_member_permissions WHERE member_id='sup'").run();
eq(shape(await get('sup2')),[['rep3',1,0,'record',0]],'the other supervisor: their own representative only');

// ---- 3. The reader with a fixed clock: the day in Riyadh around midnight, the start from GPS evidence, a day off, before 6 AM.
const FIXED='2026-03-03',NEXT='2026-03-04';
activity('m-rep1-in','rep1',{date:null,at:'2026-03-02T21:30:00.000Z'});// 00:30 on the 3rd in Riyadh: the 3rd
activity('m-rep1-out','rep1',{date:null,at:'2026-03-02T20:59:00.000Z'});// 23:59 on the 2nd in Riyadh: not the 3rd
activity('m-rep2-call','rep2',{type:'call',date:FIXED,at:'2026-03-03T08:00:00.000Z',extra:{offlineRecordedAt:'2026-03-03T05:30:00.000Z'}});// recorded offline at 08:30
activity('m-rep4-visit','rep4',{date:FIXED,at:'2026-03-03T07:00:00.000Z'});
activity('m-rep1-next','rep1',{date:null,at:'2026-03-03T21:05:00.000Z'});// 00:05 on the 4th in Riyadh
// rep2's phone: still at 07:00 and 07:01 (Riyadh), then moving at 08:00 -> 08:01.
sql.prepare("INSERT INTO crm_mobile_route_days(id,member_id,device_id,date,region_scope,started_at,ended_at,last_point_at,data,version) VALUES('day-rep2','rep2','dev-1',?,'eastern','2026-03-03T03:00:00.000Z','2026-03-03T15:00:00.000Z','2026-03-03T05:01:00.000Z',?,1)").run(FIXED,JSON.stringify({gaps:[],trackingWindow:'06-18'}));
const mobilePoint=(id,at,latitude,longitude=50.03)=>sql.prepare("INSERT INTO crm_mobile_route_points(day_id,point_id,captured_at,received_at,latitude,longitude,accuracy,stop_id) VALUES('day-rep2',?,?,?,?,?,10,NULL)").run(id,at,at,latitude,longitude);
mobilePoint('p1','2026-03-03T04:00:00.000Z',26.43);mobilePoint('p2','2026-03-03T04:01:00.000Z',26.43);mobilePoint('p3','2026-03-03T05:00:00.000Z',26.43);mobilePoint('p4','2026-03-03T05:01:00.000Z',26.435);
// rep4's route to the customer (the browser tracker): moving at 09:10 -> 09:11.
sql.prepare("INSERT INTO crm_journey_stops(id,member_id,date,customer_id,region_scope,snapshot,selected_at,closed_at,state,data,version) VALUES('stop-rep4','rep4',?,'c1','eastern',?,'2026-03-03T06:00:00.000Z','2026-03-03T07:30:00.000Z','interrupted',?,1)").run(FIXED,JSON.stringify({customerName:'مصنع الشرق',region:'الشرقية',latitude:26.43,longitude:50.03}),JSON.stringify({arrivalAt:null,departureAt:null,durationSeconds:null,durationUncertain:false,observedSeconds:0,gaps:[],events:[{type:'selected',at:'2026-03-03T06:00:00.000Z'}],trackingWindow:'06-18'}));
const stopPoint=(id,at,latitude)=>sql.prepare("INSERT INTO crm_journey_points(stop_id,point_id,captured_at,received_at,latitude,longitude,accuracy) VALUES('stop-rep4',?,?,?,?,50.0,10)").run(id,at,at,latitude);
stopPoint('s1','2026-03-03T06:10:00.000Z',26.40);stopPoint('s2','2026-03-03T06:11:00.000Z',26.405);
const read=async(id,at)=>{as(id);return server.readTeamToday(await crmServer.context({load:'directory'}),at);};
data=await read('sup','2026-03-03T09:00:00.000Z');
eq([data.date,data.workingDay,data.windowStartsAt],[FIXED,true,'2026-03-03T03:00:00.000Z'],'noon in Riyadh on a Tuesday');
eq(shape(data).map(r=>r.slice(0,4)),[['rep2',0,1,'movement'],['rep1',1,0,'record'],['rep4',1,0,'movement']],'rep2 started by moving (before the call recorded offline), rep1 by the record of 00:30 (the visit of 23:59 the day before is not today\'s), rep4 by moving on the route before the visit');
eq(Object.fromEntries(data.rows.map(r=>[r.memberId,r.startedAt])),{rep2:'2026-03-03T05:01:00.000Z',rep1:'2026-03-02T21:30:00.000Z',rep4:'2026-03-03T06:11:00.000Z'},'the times: the first observed movement (not the still phone of 07:00), and the record');
// The same numbers as the day report: GET /api/journeys of that day, member by member («أول حركة مرصودة», «زيارات مسجلة», «تواصل آخر مسجل»).
for(const id of ['rep1','rep2','rep4']){
 as('sup');const response=await journeys.GET(new Request('https://test.invalid/api/journeys?date='+FIXED+'&memberId='+id)),report=await response.json();
 eq(response.status,200,'the day report of '+id);
 const summary=report.daily.summary,mine=data.rows.find(r=>r.memberId===id);
 eq([summary.recordedVisits,summary.recordedCommunications],[mine.visits,mine.contacts],id+': the visits and other contacts of the day report');
 if(mine.startedBy==='movement')eq(summary.firstMovementAt,mine.startedAt,id+': the start is the day report\'s «أول حركة مرصودة»');
 else eq(summary.firstMovementAt,null,id+': no movement in the day report either');
}
data=await read('sup','2026-03-03T21:10:00.000Z');
eq([data.date,shape(data).map(r=>r.slice(0,4))],[NEXT,[['rep2',0,0,null],['rep4',0,0,null],['rep1',1,0,'record']]],'ten past midnight in Riyadh: the 4th, only the record of 00:05 counts; the 3rd\'s work and GPS are yesterday\'s');
eq(data.rows.find(r=>r.memberId==='rep1').startedAt,'2026-03-03T21:05:00.000Z','started at 00:05');
data=await read('sup','2026-03-06T09:00:00.000Z');
eq([data.date,data.workingDay,data.totals.started],['2026-03-06',false,0],'a Friday is the weekly day off');
data=await read('sup','2026-03-03T02:00:00.000Z');
eq([data.serverTime<data.windowStartsAt,shape(data).map(r=>r.slice(0,4))],[true,[['rep2',0,1,null],['rep4',1,0,null],['rep1',1,0,'record']]],'05:00 in Riyadh, before the tracking hours: only rep1, whose visit was recorded at 00:30, has started; work dated today but recorded after this moment counts as the day report counts it (by its date) and starts nobody\'s day, and GPS of later hours is not read yet');
console.log(JSON.stringify({ok:true,checks,syntheticFixtures:true,productionDataUsed:false}));
