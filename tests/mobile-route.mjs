// Execute real journey engine and route handlers against isolated SQLite.
// Authentication alone is mocked; no live data, GPS or network is used.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'journeys-')),seen=new Set();
process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const u=globalThis.testUser;if(!u)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version FROM crm_members WHERE user_id=? OR email=?').bind(u.userId,u.email).first();return {...u,provider:'email-otp',memberId:m?.id||'missing',memberVersion:m?.auth_version};}`);
function compile(relative){
 if(seen.has(relative))return;seen.add(relative);
 const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));
 fs.mkdirSync(path.dirname(dest),{recursive:true});
 let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
  if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));
  if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));
  if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
  let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
  if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';
  compile(source);return 'from '+JSON.stringify(path.join(out,source.replace(/\.tsx?$/,'.mjs')));
 });fs.writeFileSync(dest,code);
}
for(const name of ['journeys','visits','customer-followups','mobile-route'])compile('app/api/'+name+'/route.ts');
compile('lib/journeys.ts');
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const filename of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+filename,'utf8'));
let race=null;
class Statement{
 constructor(q,a=[]){this.q=q;this.a=a;}
 bind(...a){return new Statement(this.q,a);}
 async run(){const r=sql.prepare(this.q).run(...this.a);return {meta:{changes:Number(r.changes)}};}
 async all(){return {results:sql.prepare(this.q).all(...this.a)};}
 async first(){return sql.prepare(this.q).get(...this.a)||null;}
}
const DB={prepare:q=>new Statement(q),batch:async statements=>{if(race){const action=race;race=null;await action();}sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid'};
const NativeDate=Date;let clock=NativeDate.parse('2026-09-30T09:00:00.000Z');
globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
process.on('exit',()=>{globalThis.Date=NativeDate;});
const iso=offset=>new Date(clock+(offset||0)).toISOString();
const advance=milliseconds=>{clock+=milliseconds;};

function member(id,role,supervisor='',region='eastern',active=1,createdAt=iso()){sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,?,0,?)').run(id,'u-'+id,id+'@yourrest.org',id,role,'الرئيسي',supervisor||null,region,active,createdAt);}
member('owner','admin','','all');member('manager','manager');member('other-manager','manager');member('supervisor','supervisor','manager');member('other-supervisor','supervisor','other-manager');member('rep','rep','supervisor');member('peer','rep','supervisor');member('outsider','rep','other-supervisor');member('western','rep','supervisor','western');member('inactive','rep','supervisor','eastern',0);member('service','customer_service');
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-owner')").run();
function customer(id,region='الشرقية',coordinates={latitude:26.437341,longitude:50.034499}){
 const data={name:'Factory '+id,region,branch:'الرئيسي',...coordinates};
 sql.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,\'customer\',NULL,\'owner\',\'الرئيسي\',?,?,?,1,\'fixture\')').run(id,JSON.stringify(data),iso(),iso());
}
customer('factory');customer('second');customer('west','الغربية');customer('no-location','الشرقية',{});
const user=id=>{globalThis.testUser=id?{userId:'u-'+id,email:id+'@yourrest.org',fullName:id}:null;};
user('rep');
const api=async name=>import(path.join(out,'app/api/'+name+'/route.mjs'));
const journeys=await api('journeys'),visits=await api('visits'),followups=await api('customer-followups'),mobile=await api('mobile-route');
const engine=await import(path.join(out,'lib/journeys.mjs'));
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const ok=(actual,message)=>{assert.ok(actual,message);checks++;};
function request(body,headers={}){return new Request('https://test.invalid/api/journeys',{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json',...headers},body:JSON.stringify(body)});}
async function post(body,status=200,route=journeys){const response=await route.POST(request(body));const payload=await response.json();eq(response.status,status,JSON.stringify(payload));return payload;}
async function get(query='',status=200){const response=await journeys.GET(new Request('https://test.invalid/api/journeys'+query));const payload=await response.json();eq(response.status,status,JSON.stringify(payload));return payload;}
const rawRecord=id=>sql.prepare('SELECT * FROM crm_records WHERE id=?').get(id);
const record=id=>({...rawRecord(id),data:JSON.parse(rawRecord(id).data)});

const target={latitude:26.437341,longitude:50.034499},deviceId=crypto.randomUUID();
const begin=(device=deviceId)=>({action:'begin',deviceId:device,createKey:crypto.randomUUID()});
const mp=(body,status=200)=>post(body,status,mobile);
// Legacy management collectors may still end; rep continuous collectors may not.
async function managedEnd(body,status=200){sql.prepare("UPDATE crm_members SET role='manager' WHERE id='rep'").run();try{return await mp(body,status);}finally{sql.prepare("UPDATE crm_members SET role='rep' WHERE id='rep'").run();}}
async function mg(status=200){const r=await mobile.GET();eq(r.status,status);return r.json();}
const at=seconds=>new Date(NativeDate.parse('2026-09-30T09:00:00.000Z')+seconds*1000).toISOString();
function point(seconds,meters=0,stopId=null,extra={}){return {id:'mobile-point-'+seconds,capturedAt:at(seconds),latitude:target.latitude+meters/111194.9266,longitude:target.longitude,accuracy:10,stopId,...extra};}
user(null);await mg(401);await mp(begin(),401);
user('inactive');await mg(403);user('service');await mp(begin(),403);user('rep');
eq((await mg()).memberId,'rep');eq((await mg()).day,null);
const badOrigin=await mobile.POST(request(begin(),{origin:'https://evil.invalid'}));eq(badOrigin.status,403);
const crossSite=await mobile.POST(request(begin(),{'sec-fetch-site':'cross-site'}));eq(crossSite.status,403);
const invalidJson=await mobile.POST(new Request('https://test.invalid/api/mobile-route',{method:'POST',headers:{origin:'https://test.invalid'},body:'{bad'}));eq(invalidJson.status,400);
await mp({...begin(),deviceId:'fake'},400);await mp({...begin(),createKey:'fake'},400);
const begun=begin();let day=(await mp(begun)).day;eq(day.date,'2026-09-30');eq(day.regionScope,'eastern');eq(day.memberId,'rep');eq(day.expiresAt,'2026-09-30T15:00:00.000Z');eq(day.lastPointAt,null);
eq((await mp(begun)).day.id,day.id,'Begin key retries are idempotent');eq((await mp(begin())).day.id,day.id,'Same active device reuses day');await mp(begin(crypto.randomUUID()),409);
const samples=points=>({action:'samples',dayId:day.id,deviceId,points});
const dbCount=table=>sql.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
await mp(samples([]),400);await mp(samples([point(0),point(0)]),400);await mp(samples([point(0),point(0,0,null,{id:'x'})]),400);
for(const bad of [point(-1),point(6),point(0,0,null,{accuracy:-1}),point(0,0,null,{latitude:0,longitude:0}),point(0,0,null,{latitude:91}),point(0,0,null,{extra:'invalid'}),{...point(0),stopId:undefined}])await mp(samples([bad]),400);
eq(dbCount('crm_mobile_route_points'),0);
let sampleResult=await mp(samples([point(0)]));eq(sampleResult.acknowledgedIds,['mobile-point-0']);eq(sampleResult.day.lastPointAt,at(0));eq(dbCount('crm_mobile_route_points'),1);
eq((await mp(samples([point(0)]))).day.version,sampleResult.day.version);await mp(samples([point(0,1)]),409);await mp(samples([point(0,0,null,{id:'alternate'})]),409);
user('peer');await mp(samples([point(0)]),404);user('owner');await mp(samples([point(0)]),404);user('rep');await mp({...samples([point(0)]),deviceId:crypto.randomUUID()},409);
// First physical stop links only its own queued points and updates the visit result.
clock=NativeDate.parse(at(10));const stop=(await post({action:'select',customerId:'factory',createKey:crypto.randomUUID()})).stop;
clock=NativeDate.parse(at(45));sampleResult=await mp(samples([point(15,0,stop.id),point(30,0,stop.id),point(45,0,stop.id)]));eq(sampleResult.activeStop.state,'onsite');eq(sampleResult.activeStop.data.arrivalAt,at(15));
const visitBody={createKey:crypto.randomUUID(),customerId:'factory',customerVersion:rawRecord('factory').version,timingMode:'automatic',elapsedMilliseconds:2700000,data:{type:'visit',date:day.date,summary:'تعريف بمنتجات الشركة',result:'متابعة العميل',salesStage:'new',strength:'strong',nextAction:'متابعة المواصفات',nextDate:day.date,requestedProducts:['قوالب البلوك المتحركة'],location:target.latitude+', '+target.longitude,locationSource:'device',locationCapturedAt:iso(),locationAccuracy:10,journeyStopId:stop.id}};
const savedVisit=await post(visitBody,200,visits);eq(record(savedVisit.id).data.startedAt,at(15));
clock=NativeDate.parse(at(105));sampleResult=await mp(samples([point(60,300,stop.id),point(75,300,stop.id),point(90,600,stop.id),point(105,900,null)]));eq(sampleResult.activeStop,null);eq(sampleResult.day.endedAt,null,'Day continues after stop departure');eq(record(savedVisit.id).data.endedAt,at(60));eq(record(savedVisit.id).data.durationSeconds,45);eq(dbCount('crm_mobile_route_points'),8);eq(dbCount('crm_journey_points'),5,'Post-departure route samples stay only in day route');
const ownStop=await journeys.GET(new Request('https://test.invalid/api/journeys?stopId='+stop.id));eq(ownStop.status,200);eq((await ownStop.json()).stop.state,'completed');
user('peer');const foreignStop=await journeys.GET(new Request('https://test.invalid/api/journeys?stopId='+stop.id));eq(foreignStop.status,404);user('rep');
const ambiguous=await journeys.GET(new Request('https://test.invalid/api/journeys?stopId='+stop.id+'&date='+day.date));eq(ambiguous.status,400);
// Queue does not reattribute old completed stop samples to a new selected client.
clock=NativeDate.parse(at(110));const nextStop=(await post({action:'select',customerId:'second',createKey:crypto.randomUUID()})).stop;
clock=NativeDate.parse(at(180));await mp(samples([point(120,0,stop.id),point(135,0,stop.id)]));let activeResult=await get();eq(activeResult.active.id,nextStop.id);eq(activeResult.active.data.arrivalAt,null);
await mp(samples([point(150,0,nextStop.id),point(165,0,nextStop.id)]));eq((await get()).active.data.arrivalAt,at(150));
// A queued, fully observed offline interval remains exact: receipt time is irrelevant.
clock=NativeDate.parse(at(1200));await mp(samples([point(180,0,nextStop.id),point(195,300,nextStop.id),point(210,300,nextStop.id)]));eq((await journeys.GET(new Request('https://test.invalid/api/journeys?stopId='+nextStop.id)).then(r=>r.json())).stop.data.durationSeconds,45);
await mp(samples([point(205,600,null)]),409);await mp(samples([point(215,0,'missing')]),404);
// Report applies team AND both current/snapshot territory, including all-region staff.
user('rep');await get('?date='+day.date,403);user('supervisor');let report=await get('?date='+day.date+'&memberId=rep');eq(report.mobileDays.length,1);eq(report.mobileDays[0].memberId,'rep');eq(report.mobileDays[0].deviceId,undefined);eq(report.mobileDays[0].points.length,15);ok(report.mobileDays[0].segments.length>0);ok(report.mobileDays[0].gaps.some(g=>g.reason==='no_recent_location'),'No fresh sample is explicitly incomplete');
user('other-supervisor');await get('?date='+day.date+'&memberId=rep',403);user('supervisor');eq((await get('?date='+day.date+'&memberId=western')).mobileDays.length,0);
sql.prepare("UPDATE crm_members SET region_scope='all' WHERE id='rep'").run();eq((await get('?date='+day.date+'&memberId=rep')).mobileDays.length,0,'Narrow region cannot read whole day of currently all-region member');sql.prepare("UPDATE crm_members SET region_scope='eastern' WHERE id='rep'").run();
sql.prepare("UPDATE crm_mobile_route_days SET region_scope='all' WHERE id=?").run(day.id);eq((await get('?date='+day.date+'&memberId=rep')).mobileDays.length,0,'Narrow region cannot read all-region snapshot path');user('owner');eq((await get('?date='+day.date+'&memberId=rep')).mobileDays.length,1);sql.prepare("UPDATE crm_mobile_route_days SET region_scope='eastern' WHERE id=?").run(day.id);user('rep');
// Every point/day/linked visit write is guarded against a permissions race at commit.
const countBefore=dbCount('crm_mobile_route_points');race=()=>sql.prepare("UPDATE crm_members SET region_scope='western' WHERE id='rep'").run();await mp(samples([point(225,300,null)]),409);eq(dbCount('crm_mobile_route_points'),countBefore);await mp(samples([point(225,300,null)]),403);sql.prepare("UPDATE crm_members SET region_scope='eastern' WHERE id='rep'").run();
race=()=>sql.prepare("UPDATE crm_members SET active=0 WHERE id='rep'").run();await mp(samples([point(225,300,null)]),409);eq(dbCount('crm_mobile_route_points'),countBefore);sql.prepare("UPDATE crm_members SET active=1 WHERE id='rep'").run();
race=()=>sql.prepare('UPDATE crm_mobile_route_days SET version=version+1 WHERE id=?').run(day.id);await mp(samples([point(225,300,null)]),409);eq(dbCount('crm_mobile_route_points'),countBefore);
// Concurrent stop/customer mutations invalidate the whole batch including unrelated route points.
clock=NativeDate.parse(at(1250));const raceStop=(await post({action:'select',customerId:'factory',createKey:crypto.randomUUID()})).stop;
clock=NativeDate.parse(at(1300));race=()=>sql.prepare('UPDATE crm_journey_stops SET version=version+1 WHERE id=?').run(raceStop.id);await mp(samples([point(1260,0,raceStop.id)]),409);eq(dbCount('crm_mobile_route_points'),countBefore);
race=()=>sql.prepare("UPDATE crm_records SET data=json_set(data,'$.region','الغربية'),version=version+1 WHERE id='factory'").run();await mp(samples([point(1260,0,raceStop.id)]),409);eq(dbCount('crm_mobile_route_points'),countBefore);sql.prepare("UPDATE crm_records SET data=json_set(data,'$.region','الشرقية'),version=version+1 WHERE id='factory'").run();
await mp(samples([point(1260,0,raceStop.id),point(1275,0,raceStop.id)]));
// Explicit gaps are device events; app backgrounding is not a gap.
await mp({action:'gap',dayId:day.id,deviceId,at:at(1280),reason:'app_hidden'},400);
const gap={action:'gap',dayId:day.id,deviceId,at:at(1280),reason:'gps_unavailable'};sampleResult=await mp(gap);eq(sampleResult.day.gaps.at(-1).reason,'gps_unavailable');eq((await mp(gap)).day.version,sampleResult.day.version,'Gap retry is idempotent');eq((await get()).active.data.durationUncertain,true);
const finalVisit=await post({...visitBody,createKey:crypto.randomUUID(),customerVersion:rawRecord('factory').version,data:{...visitBody.data,locationCapturedAt:iso(),journeyStopId:raceStop.id}},200,visits);eq(record(finalVisit.id).data.journeyStopId,raceStop.id);
await mp({action:'end',dayId:day.id,deviceId,endedAt:at(1300)},403);eq(sql.prepare('SELECT ended_at FROM crm_mobile_route_days WHERE id=?').get(day.id).ended_at,null);await post({action:'end',stopId:raceStop.id,reason:'day_end'},403);await post({action:'end',stopId:raceStop.id,reason:'manual_end'},403);
await managedEnd({action:'end',dayId:day.id,deviceId,endedAt:at(1200)},400);race=()=>sql.prepare('UPDATE crm_journey_stops SET version=version+1 WHERE id=?').run(raceStop.id);await managedEnd({action:'end',dayId:day.id,deviceId,endedAt:at(1300)},409);eq(sql.prepare('SELECT ended_at FROM crm_mobile_route_days WHERE id=?').get(day.id).ended_at,null,'Day end and visit closure remain atomic on race');eq(sql.prepare('SELECT closed_at FROM crm_journey_stops WHERE id=?').get(raceStop.id).closed_at,null);sampleResult=await managedEnd({action:'end',dayId:day.id,deviceId,endedAt:at(1300)});eq(sampleResult.day.endedAt,at(1300));eq(sampleResult.activeStop,null,'Management collector end also closes the active visit');const endedStop=sql.prepare('SELECT state,closed_at,data FROM crm_journey_stops WHERE id=?').get(raceStop.id);eq(endedStop.state,'interrupted');eq(endedStop.closed_at,at(1300));eq(JSON.parse(endedStop.data).departureAt,null);eq(record(finalVisit.id).data.durationSeconds,null);eq(record(finalVisit.id).data.durationReview,true);eq((await managedEnd({action:'end',dayId:day.id,deviceId,endedAt:at(1300)})).day.version,sampleResult.day.version);await managedEnd({action:'end',dayId:day.id,deviceId,endedAt:at(1299)},409);
clock=NativeDate.parse(at(1500));await mp(samples([point(1290,300,null)]));await mp(samples([point(1301,300,null)]),400);eq((await mg()).day.endedAt,at(1300));
// Next session and next workday rollover keep separate non-overlapping day collectors.
const newDay=(await mp(begin())).day;ok(newDay.id!==day.id);eq(newDay.endedAt,null);clock=NativeDate.parse('2026-10-01T03:00:01.000Z');eq((await mg()).day,null);let rollover=(await mp(begin())).day;eq(rollover.date,'2026-10-01');eq(sql.prepare('SELECT ended_at FROM crm_mobile_route_days WHERE id=?').get(newDay.id).ended_at,'2026-09-30T15:00:00.000Z');
const oldSamples={action:'samples',dayId:newDay.id,deviceId,points:[{...point(1600),id:'old-end',capturedAt:'2026-09-30T14:59:55.000Z'}]};await mp(oldSamples);await mp({...oldSamples,points:[{...oldSamples.points[0],id:'midnight',capturedAt:'2026-09-30T21:00:00.000Z'}]},400);
clock=NativeDate.parse('2026-10-03T21:00:01.000Z');const delayedPoint={...oldSamples.points[0],id:'past-48-hours',capturedAt:'2026-09-30T14:59:56.000Z'};await mp({...oldSamples,points:[delayedPoint]});eq({...sql.prepare('SELECT captured_at,received_at FROM crm_mobile_route_points WHERE day_id=? AND point_id=?').get(newDay.id,delayedPoint.id)},{captured_at:delayedPoint.capturedAt,received_at:iso()},'An upload after 48 hours retains capture time and separate receipt time');
// Foreign stop and denied member writes never create new collectors or points.
clock=NativeDate.parse('2026-10-03T09:00:00.000Z');user('peer');const peerDevice=crypto.randomUUID(),peerDay=(await mp(begin(peerDevice))).day,peerStop=(await post({action:'select',customerId:'factory',createKey:crypto.randomUUID()})).stop;user('rep');let ownDay=(await mp(begin())).day;const todayPoint={id:'foreign-test',capturedAt:iso(),...target,accuracy:10,stopId:peerStop.id};await mp({action:'samples',deviceId,dayId:ownDay.id,points:[todayPoint]},404);await mp({action:'samples',deviceId:peerDevice,dayId:peerDay.id,points:[{...todayPoint,stopId:null}]},404);
const beforeCollectors=dbCount('crm_mobile_route_days');user('western');race=()=>sql.prepare("UPDATE crm_members SET role='customer_service' WHERE id='western'").run();await mp(begin(crypto.randomUUID()),409);eq(dbCount('crm_mobile_route_days'),beforeCollectors);sql.prepare("UPDATE crm_members SET role='rep' WHERE id='western'").run();
// A late queue for a closed day cannot cross its explicit end or change the end timestamp.
user('rep');const preciseEnd=iso();await managedEnd({action:'end',dayId:ownDay.id,deviceId,endedAt:preciseEnd});advance(1000);await mp({action:'samples',dayId:ownDay.id,deviceId,points:[{...todayPoint,id:'after-explicit-end',capturedAt:iso(),stopId:null}]},400);
// Bounds apply inside the guarded write, across all sessions belonging to the same day.
const capped=(await mp(begin())).day;sql.prepare(`WITH RECURSIVE x(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM x WHERE n<20000) INSERT INTO crm_mobile_route_points(day_id,point_id,captured_at,received_at,latitude,longitude,accuracy,stop_id) SELECT ?,'limit-'||n,printf('2026-10-03T09:00:%06dZ',n),?,26,50,10,NULL FROM x`).run(capped.id,iso());const cappedBefore=dbCount('crm_mobile_route_points');await mp({action:'samples',dayId:capped.id,deviceId,points:[{...todayPoint,id:'over-limit',capturedAt:iso(),stopId:null}]},409);eq(dbCount('crm_mobile_route_points'),cappedBefore);await managedEnd({action:'end',dayId:capped.id,deviceId,endedAt:iso()});const currentCount=sql.prepare('SELECT COUNT(*) AS n FROM crm_mobile_route_days WHERE member_id=? AND date=?').get('rep','2026-10-03').n;for(let n=currentCount;n<20;n++)sql.prepare('INSERT INTO crm_mobile_route_days(id,member_id,device_id,date,region_scope,started_at,ended_at,data,version) VALUES(?,?,?,?,?,?,?,?,1)').run('limit-day-'+n,'rep',deviceId,'2026-10-03','eastern',iso(),iso(),JSON.stringify({gaps:[]}));const beforeLimit=dbCount('crm_mobile_route_days');await mp(begin(),409);eq(dbCount('crm_mobile_route_days'),beforeLimit);

// Rep enrollment is automatic without a selected customer. Offline dates cannot
// close today's collector, switch device/scope, or invent evidence while absent.
clock=NativeDate.parse('2026-10-06T03:00:00.000Z');member('continuous','rep','supervisor','eastern',1,'2026-10-04T03:00:00.000Z');user('continuous');
const continuousDevice=crypto.randomUUID(),continuousBegin={action:'begin',deviceId:continuousDevice,createKey:crypto.randomUUID(),continuous:true};
const continuousStarted=await mp(continuousBegin),currentDay=continuousStarted.day;
eq(continuousStarted.memberRole,'rep');eq(continuousStarted.regionScope,'eastern');eq(continuousStarted.activeStop,null);eq(currentDay.startedAt,iso());eq(currentDay.date,'2026-10-06');
await mp({action:'end',deviceId:continuousDevice,dayId:currentDay.id},403);
const selectedCurrent=(await post({action:'select',customerId:'factory',createKey:crypto.randomUUID()})).stop;
const oldBegin={action:'begin',deviceId:continuousDevice,createKey:crypto.randomUUID(),continuous:true,date:'2026-10-05',startedAt:'2026-10-04T21:00:00.000Z',regionScope:'eastern'};
const currentSnapshot=sql.prepare('SELECT * FROM crm_mobile_route_days WHERE id=?').get(currentDay.id);
await mp({...oldBegin,regionScope:undefined},403);await mp({...oldBegin,regionScope:'western'},403);
await mp({...oldBegin,date:'2026-10-03',startedAt:'2026-10-02T21:00:00.000Z'},400);
await mp({...oldBegin,date:'2026-10-07',startedAt:'2026-10-06T21:00:00.000Z'},400);
await mp({...oldBegin,date:'2026-02-30'},400);await mp({...oldBegin,startedAt:'2026-10-05T21:00:00.000Z'},400);
let oldDay=(await mp(oldBegin)).day;eq(oldDay.date,'2026-10-05');eq(oldDay.endedAt,'2026-10-05T15:00:00.000Z');eq(oldDay.lastPointAt,null);
eq(sql.prepare('SELECT * FROM crm_mobile_route_days WHERE id=?').get(currentDay.id),currentSnapshot,'Backfill cannot replace or close the active day');
eq((await mp(oldBegin)).day.id,oldDay.id);eq((await mp({...oldBegin,createKey:crypto.randomUUID()})).day.id,oldDay.id,'A second key reuses the same device/day interval');
await mp({...oldBegin,createKey:crypto.randomUUID(),deviceId:crypto.randomUUID()},409);
await mp({...oldBegin,date:'2026-10-06',startedAt:'2026-10-05T21:00:00.000Z'},409);
const offlinePoint=(id,capturedAt,stopId=null)=>({id,capturedAt,...target,accuracy:10,stopId}),oldBatch=points=>({action:'samples',deviceId:continuousDevice,dayId:oldDay.id,points});
await mp(oldBatch([offlinePoint('offline-first','2026-10-05T03:00:00.000Z')]));
const retrospectiveGap={action:'gap',deviceId:continuousDevice,dayId:oldDay.id,at:'2026-10-05T03:00:05.000Z',reason:'gps_unavailable'};
const gapResult=await mp(retrospectiveGap);eq(gapResult.day.endedAt,oldDay.endedAt);eq(gapResult.day.gaps.at(-1).reason,'gps_unavailable');eq((await mp(retrospectiveGap)).day.version,gapResult.day.version);
eq(sql.prepare('SELECT closed_at FROM crm_journey_stops WHERE id=?').get(selectedCurrent.id).closed_at,null,'An old gap must never close the current selected customer');
await mp({...retrospectiveGap,at:'2026-10-05T21:00:01.000Z'},400);
await mp(oldBatch([offlinePoint('offline-second','2026-10-05T03:00:15.000Z')]));
await mp(oldBatch([offlinePoint('wrong-stop-day','2026-10-05T03:00:30.000Z',selectedCurrent.id)]),400);
eq((await mg()).day.id,currentDay.id);eq((await mg()).activeStop.id,selectedCurrent.id);
user('supervisor');let offlineReport=await get('?date=2026-10-05&memberId=continuous');eq(offlineReport.mobileDays.length,1);eq(offlineReport.mobileDays[0].points.length,2);eq(offlineReport.mobileDays[0].automaticStops,[]);ok(offlineReport.mobileDays[0].gaps.some(g=>g.reason==='gps_unavailable'));eq(offlineReport.mobileDays[0].deviceId,undefined);
user('other-supervisor');await get('?date=2026-10-05&memberId=continuous',403);
user('manager');await mp({...begin(),continuous:true},403);user('continuous');
// Buffered points in the old day are delivered first; midnight then interrupts an
// unfinished customer visit without fabricating a departure time or attendance.
clock=NativeDate.parse('2026-10-07T03:00:01.000Z');await mp({action:'samples',deviceId:continuousDevice,dayId:currentDay.id,points:[offlinePoint('pre-rollover','2026-10-06T14:59:50.000Z',selectedCurrent.id)]});
const rollBody={action:'begin',deviceId:continuousDevice,createKey:crypto.randomUUID(),continuous:true,date:'2026-10-07',startedAt:'2026-10-06T21:00:00.000Z',regionScope:'eastern'};
const beforeRollover=sql.prepare('SELECT * FROM crm_mobile_route_days WHERE id=?').get(currentDay.id);
race=()=>sql.prepare('UPDATE crm_journey_stops SET version=version+1 WHERE id=?').run(selectedCurrent.id);await mp(rollBody,409);eq(sql.prepare('SELECT * FROM crm_mobile_route_days WHERE id=?').get(currentDay.id),beforeRollover,'Rollover and visit closure must stay atomic under races');
const rolled=(await mp(rollBody)).day;eq(rolled.startedAt,'2026-10-07T03:00:00.000Z');eq(rolled.date,'2026-10-07');eq(rolled.endedAt,null);eq(sql.prepare('SELECT ended_at FROM crm_mobile_route_days WHERE id=?').get(currentDay.id).ended_at,'2026-10-06T15:00:00.000Z');
const rolledStop=sql.prepare('SELECT closed_at,data FROM crm_journey_stops WHERE id=?').get(selectedCurrent.id);eq(rolledStop.closed_at,'2026-10-06T15:00:00.000Z');eq(JSON.parse(rolledStop.data).departureAt,null);eq(JSON.parse(rolledStop.data).durationSeconds,null);
await mp({...rollBody,createKey:crypto.randomUUID(),regionScope:'western'},403);
advance(300000);user('supervisor');const emptyReport=await get('?date=2026-10-07&memberId=continuous');eq(emptyReport.mobileDays[0].points,[]);eq(emptyReport.mobileDays[0].automaticStops,[]);ok(emptyReport.mobileDays[0].gaps.some(g=>g.reason==='no_recent_location'));
user('continuous');
// Existing-day replay remains scope bound after a territorial change.
sql.prepare("UPDATE crm_members SET region_scope='western' WHERE id='continuous'").run();await mp(oldBegin,403);await mp({action:'samples',deviceId:continuousDevice,dayId:oldDay.id,points:[offlinePoint('scope-shift','2026-10-05T00:01:00.000Z')]},403);sql.prepare("UPDATE crm_members SET region_scope='eastern' WHERE id='continuous'").run();

// A web/app reconnect can start today before native old points finish uploading.
// Only the explicit midnight interruption may be refined by that verified tail.
clock=NativeDate.parse('2026-10-08T14:55:00.000Z');member('late-replay','rep','supervisor');user('late-replay');const lateDevice=crypto.randomUUID(),lateDay=(await mp(begin(lateDevice))).day;
const lateStop=(await post({action:'select',customerId:'factory',createKey:crypto.randomUUID()})).stop;
const lp=(seconds,meters=0)=>({id:'late-'+seconds,capturedAt:new Date(NativeDate.parse('2026-10-08T14:55:00.000Z')+seconds*1000).toISOString(),latitude:target.latitude+meters/111194.9266,longitude:target.longitude,accuracy:10,stopId:lateStop.id});
const lateSamples=points=>({action:'samples',dayId:lateDay.id,deviceId:lateDevice,points});
await mp(lateSamples([lp(0)]));const replayVisit=await post({...visitBody,createKey:crypto.randomUUID(),customerVersion:rawRecord('factory').version,data:{...visitBody.data,date:lateDay.date,nextDate:lateDay.date,locationCapturedAt:iso(),journeyStopId:lateStop.id}},200,visits);
clock=NativeDate.parse('2026-10-10T03:01:00.000Z');const afterMidnight=(await mp({...begin(lateDevice),date:'2026-10-10',startedAt:'2026-10-09T21:00:00.000Z',regionScope:'eastern'})).day; // Friday is skipped; Thursday evidence keeps its captured business day.
eq(sql.prepare('SELECT state FROM crm_journey_stops WHERE id=?').get(lateStop.id).state,'interrupted');eq(record(replayVisit.id).data.durationSeconds,null);
const latePayload=lateSamples([lp(15),lp(30),lp(45,300),lp(60,300),lp(75,600)]),lateResult=await mp(latePayload);
const lateStored=sql.prepare('SELECT * FROM crm_journey_stops WHERE id=?').get(lateStop.id),lateData=JSON.parse(lateStored.data);
eq(lateStored.state,'completed');eq(lateData.arrivalAt,lp(0).capturedAt);eq(lateData.departureAt,lp(45).capturedAt);eq(lateData.durationSeconds,45);eq(lateData.durationUncertain,false);eq(record(replayVisit.id).data.durationSeconds,45);eq(record(replayVisit.id).data.endedAt,lp(45).capturedAt);
const verifiedPoints=sql.prepare('SELECT point_id AS id,captured_at AS capturedAt,received_at AS receivedAt,latitude,longitude,accuracy FROM crm_journey_points WHERE stop_id=? ORDER BY captured_at').all(lateStop.id);eq(verifiedPoints.length,5,'Route after the proven departure stays outside the customer journey');
let uninterrupted=lateStop;for(const point of verifiedPoints)uninterrupted=engine.applyJourneyPoint(uninterrupted,{...point,stopId:lateStop.id});eq(lateData,uninterrupted.data,'Late replay must equal the uninterrupted verified evidence');
eq((await mp(latePayload)).day.version,lateResult.day.version);eq(sql.prepare('SELECT * FROM crm_journey_stops WHERE id=?').get(lateStop.id),lateStored,'Duplicate late replay is a no-op');
await mp(lateSamples([lp(90,900)]));eq(sql.prepare('SELECT * FROM crm_journey_stops WHERE id=?').get(lateStop.id),lateStored,'Completed journey stays immutable');
sql.prepare("UPDATE crm_members SET region_scope='western' WHERE id='late-replay'").run();await mp(lateSamples([lp(105,900)]),403);sql.prepare("UPDATE crm_members SET region_scope='eastern' WHERE id='late-replay'").run();
// A cancellation or genuine management manual end cannot be reopened by old GPS.
for(const reason of ['contact_type_changed','manual_end']){
 clock+=60000;const cancelled=(await post({action:'select',customerId:'second',createKey:crypto.randomUUID()})).stop,cancelPoint={id:'cancel-first-'+reason,capturedAt:iso(),...target,accuracy:10,stopId:cancelled.id};
 await mp({action:'samples',dayId:afterMidnight.id,deviceId:lateDevice,points:[cancelPoint]});clock+=60000;
 if(reason==='manual_end')sql.prepare("UPDATE crm_members SET role='manager' WHERE id='late-replay'").run();await post({action:'end',stopId:cancelled.id,reason});if(reason==='manual_end')sql.prepare("UPDATE crm_members SET role='rep' WHERE id='late-replay'").run();
 const before=sql.prepare('SELECT * FROM crm_journey_stops WHERE id=?').get(cancelled.id);await mp({action:'samples',dayId:afterMidnight.id,deviceId:lateDevice,points:[{...cancelPoint,id:'cancel-late-'+reason,capturedAt:new Date(NativeDate.parse(cancelPoint.capturedAt)+30000).toISOString()}]});eq(sql.prepare('SELECT * FROM crm_journey_stops WHERE id=?').get(cancelled.id),before);
}
// Explicit gaps remain conservative when a midnight interruption is replayed.
const mobileEngine=await import(path.join(out,'lib/mobile-route.mjs'));let withGap=engine.applyJourneyPoint(lateStop,{...lp(0),stopId:undefined});withGap=engine.journeyGap(withGap,lp(10).capturedAt,'gps_unavailable');withGap=engine.closeJourney(withGap,lateDay.expiresAt,'day_ended');
const gapReplay=mobileEngine.replayMobileRolloverStop(withGap,[lp(0),lp(15),lp(30),lp(45,300),lp(60,300)]);ok(gapReplay.data.gaps.some(g=>g.reason==='gps_unavailable'));eq(gapReplay.data.arrivalAt,lp(15).capturedAt,'A pre-arrival gap breaks the candidate and cannot claim earlier arrival');
let arrivedGap=engine.applyJourneyPoint(engine.applyJourneyPoint(lateStop,lp(0)),lp(15));arrivedGap=engine.journeyGap(arrivedGap,lp(30).capturedAt,'permission_denied');arrivedGap=engine.closeJourney(arrivedGap,lateDay.expiresAt,'day_ended');const uncertainReplay=mobileEngine.replayMobileRolloverStop(arrivedGap,[lp(0),lp(15),lp(45),lp(60,300),lp(75,300)]);eq(uncertainReplay.data.durationUncertain,true);eq(uncertainReplay.data.durationSeconds,null);ok(uncertainReplay.data.gaps.some(g=>g.reason==='permission_denied'));
member('backfill-race','rep','supervisor','eastern',1,'2026-10-07T03:00:00.000Z');user('backfill-race');const beforeRaceCount=dbCount('crm_mobile_route_days');race=()=>sql.prepare("UPDATE crm_members SET role='customer_service' WHERE id='backfill-race'").run();await mp({...begin(crypto.randomUUID()),date:'2026-10-08',startedAt:'2026-10-07T21:00:00.000Z',regionScope:'eastern'},409);eq(dbCount('crm_mobile_route_days'),beforeRaceCount);

// A newly selected customer never inherits the old immutable offline outbox.
// Authenticated old observations may refine only the recorded switch interval.
clock=NativeDate.parse('2026-10-10T09:00:00.000Z');member('queued-switch','rep','supervisor');user('queued-switch');
const queueDevice=crypto.randomUUID(),queueDay=(await mp(begin(queueDevice))).day;
const capturedStop=(await post({action:'select',customerId:'factory',createKey:crypto.randomUUID()})).stop;
const capture=(seconds,meters=0,stopId=capturedStop.id)=>({id:'switch-'+seconds+'-'+(stopId||'unbound'),capturedAt:new Date(NativeDate.parse('2026-10-10T09:00:00.000Z')+seconds*1000).toISOString(),latitude:target.latitude+meters/111194.9266,longitude:target.longitude,accuracy:10,stopId});
const queueSamples=points=>({action:'samples',deviceId:queueDevice,dayId:queueDay.id,points});
const queuedVisit=(await post({...visitBody,createKey:crypto.randomUUID(),customerVersion:rawRecord('factory').version,data:{...visitBody.data,date:queueDay.date,nextDate:queueDay.date,journeyStopId:capturedStop.id,locationCapturedAt:iso()}},200,visits)).id;
const beforeQueuedVisit=rawRecord(queuedVisit);eq(record(queuedVisit).data.startedAt,'');
clock=NativeDate.parse(capture(90).capturedAt);const newSelection=(await post({action:'select',customerId:'second',createKey:crypto.randomUUID()})).stop;
const stopRaw=id=>sql.prepare('SELECT * FROM crm_journey_stops WHERE id=?').get(id),stopData=id=>JSON.parse(stopRaw(id).data);
const untouchedSelection=stopRaw(newSelection.id);eq(stopRaw(capturedStop.id).state,'interrupted');eq(stopData(capturedStop.id).events.at(-1).reason,'customer_changed');
const arrivalReplay=await mp(queueSamples([capture(15),capture(30)]));eq(arrivalReplay.acknowledgedIds,[capture(15).id,capture(30).id]);
eq(stopData(capturedStop.id).arrivalAt,capture(15).capturedAt);eq(stopData(capturedStop.id).departureAt,null,'The customer switch cannot manufacture a departure');eq(stopData(capturedStop.id).durationSeconds,null);eq(stopRaw(capturedStop.id).closed_at,capture(90).capturedAt);
eq(stopRaw(newSelection.id),untouchedSelection,'Old captured points must not mutate the new selected customer');eq(record(queuedVisit).data.startedAt,capture(15).capturedAt);eq(record(queuedVisit).data.endedAt,'');ok(rawRecord(queuedVisit).version>beforeQueuedVisit.version,'Only verified timing changes the linked visit version');
await mp(queueSamples([capture(45,300),capture(60,300)]));eq(stopRaw(capturedStop.id).state,'completed');eq(stopData(capturedStop.id).departureAt,capture(45).capturedAt);eq(stopData(capturedStop.id).durationSeconds,30);eq(record(queuedVisit).data.durationSeconds,30);eq(record(queuedVisit).data.endedAt,capture(45).capturedAt);eq(stopRaw(newSelection.id),untouchedSelection);
const completedReplay=stopRaw(capturedStop.id);eq((await mp(queueSamples([capture(45,300),capture(60,300)]))).acknowledgedIds,[capture(45,300).id,capture(60,300).id]);eq(stopRaw(capturedStop.id),completedReplay,'Retry cannot change completed geographic evidence');
await mp(queueSamples([capture(75,900)]));eq(stopRaw(capturedStop.id),completedReplay);

// Captured gap bindings also survive a customer switch; null remains unbound.
clock=NativeDate.parse(capture(150).capturedAt);const finalSelection=(await post({action:'select',customerId:'factory',createKey:crypto.randomUUID()})).stop,finalSelectionBefore=stopRaw(finalSelection.id);
await mp(queueSamples([capture(105,0,newSelection.id),capture(120,0,newSelection.id)]));
const oldGap={action:'gap',dayId:queueDay.id,deviceId:queueDevice,stopId:newSelection.id,at:capture(130).capturedAt,reason:'gps_unavailable'};
await mp(oldGap);ok(stopData(newSelection.id).gaps.some(g=>g.reason==='gps_unavailable'&&g.to===oldGap.at));eq(stopRaw(finalSelection.id),finalSelectionBefore,'A late old-customer gap cannot corrupt the current customer');
await mp(queueSamples([capture(135,0,newSelection.id),capture(150,0,newSelection.id)]));eq(stopData(newSelection.id).durationSeconds,null);eq(stopData(newSelection.id).departureAt,null);eq(stopRaw(newSelection.id).closed_at,capture(150).capturedAt);
const retrospective={...oldGap,at:capture(110).capturedAt,reason:'permission_denied'};
const lateGapResult=await mp(retrospective);ok(lateGapResult.day.gaps.some(g=>g.reason==='permission_denied'&&g.from===capture(105).capturedAt&&g.to===capture(110).capturedAt));ok(stopData(newSelection.id).gaps.some(g=>g.reason==='permission_denied'&&g.to===retrospective.at));eq(stopRaw(finalSelection.id),finalSelectionBefore);
const afterLateGap=stopRaw(newSelection.id);eq((await mp(retrospective)).day.version,lateGapResult.day.version,'Captured old-gap retries are idempotent');eq(stopRaw(newSelection.id),afterLateGap);
await mp({...oldGap,stopId:null,at:capture(143).capturedAt,reason:'service_stopped'});eq(stopRaw(newSelection.id),afterLateGap);eq(stopRaw(finalSelection.id),finalSelectionBefore,'Explicitly unbound route gaps cannot be inferred onto a customer');
await mp({...oldGap,stopId:finalSelection.id,at:capture(149).capturedAt},400);
user('peer');await mp({...oldGap,dayId:peerDay.id,deviceId:peerDevice},404);user('queued-switch');
sql.prepare("UPDATE crm_records SET data=json_set(data,'$.region','الغربية'),version=version+1 WHERE id='second'").run();const preDenied=dbCount('crm_mobile_route_points');await mp(queueSamples([capture(151,0,newSelection.id)]),403);await mp({...oldGap,at:capture(144).capturedAt,reason:'tracking_paused'},403);eq(dbCount('crm_mobile_route_points'),preDenied);sql.prepare("UPDATE crm_records SET data=json_set(data,'$.region','الشرقية'),version=version+1 WHERE id='second'").run();
race=()=>sql.prepare('UPDATE crm_journey_stops SET version=version+1 WHERE id=?').run(newSelection.id);await mp({...oldGap,at:capture(144).capturedAt,reason:'tracking_paused'},409);eq(stopRaw(finalSelection.id),finalSelectionBefore,'A racing old-stop update cannot mutate the new one');
// Upload age is not a deletion deadline. A month-old captured day is admitted
// after enrollment, independently of today's active collector and current stop.
clock=NativeDate.parse('2026-10-20T09:00:00.000Z');
member('month-offline','rep','supervisor','eastern',1,'2026-09-01T08:00:00.000Z');user('month-offline');
const monthDevice=crypto.randomUUID(),monthCurrent=(await mp({...begin(monthDevice),continuous:true})).day;
const monthSelected=(await post({action:'select',customerId:'factory',createKey:crypto.randomUUID()})).stop;
const monthCurrentBefore=sql.prepare('SELECT * FROM crm_mobile_route_days WHERE id=?').get(monthCurrent.id),monthStopBefore=stopRaw(monthSelected.id);
const monthBegin={...begin(monthDevice),continuous:true,date:'2026-09-20',startedAt:'2026-09-19T21:00:00.000Z',regionScope:'eastern'};
await mp({...monthBegin,date:'2026-08-31',startedAt:'2026-08-31T03:00:00.000Z'},400);
await mp({...monthBegin,date:'2026-10-21',startedAt:'2026-10-21T03:00:00.000Z'},400);
await mp({...monthBegin,regionScope:'western'},403);await mp({...monthBegin,regionScope:undefined},403);
const beforeFriday=dbCount('crm_mobile_route_days');eq((await mp({...monthBegin,date:'2026-09-18',startedAt:'2026-09-18T03:00:00.000Z'})).day,null);eq(dbCount('crm_mobile_route_days'),beforeFriday,'Late upload cannot create a Friday collector');
const monthDay=(await mp(monthBegin)).day;
eq(monthDay.startedAt,'2026-09-20T03:00:00.000Z');eq(monthDay.endedAt,'2026-09-20T15:00:00.000Z');
eq((await mp(monthBegin)).day.id,monthDay.id);eq((await mp({...monthBegin,createKey:crypto.randomUUID()})).day.id,monthDay.id);
await mp({...monthBegin,createKey:crypto.randomUUID(),deviceId:crypto.randomUUID()},409);
eq(sql.prepare('SELECT * FROM crm_mobile_route_days WHERE id=?').get(monthCurrent.id),monthCurrentBefore,'Historical begin does not end or replace the current collector');eq(stopRaw(monthSelected.id),monthStopBefore);
const monthPoint=(id,capturedAt)=>({id,capturedAt,...target,accuracy:10,stopId:null});
const monthBatch=points=>({action:'samples',dayId:monthDay.id,deviceId:monthDevice,points});
const monthPoints=[monthPoint('month-first','2026-09-20T03:00:00.000Z'),monthPoint('month-next','2026-09-20T03:00:15.000Z')];
const outsideHours=monthPoint('month-outside-hours','2026-09-20T02:59:59.000Z'),outsideResult=await mp(monthBatch([outsideHours]));eq(outsideResult.ignoredIds,[outsideHours.id]);eq(sql.prepare('SELECT point_id FROM crm_mobile_route_points WHERE day_id=? AND point_id=?').get(monthDay.id,outsideHours.id),undefined,'Legacy out-of-hours points are acknowledged without storing tracking evidence');
const monthAccepted=await mp(monthBatch(monthPoints));eq(monthAccepted.acknowledgedIds,monthPoints.map(point=>point.id));
const monthStored=sql.prepare('SELECT captured_at,received_at FROM crm_mobile_route_points WHERE day_id=? ORDER BY captured_at').all(monthDay.id);eq(monthStored.map(row=>row.captured_at),monthPoints.map(point=>point.capturedAt));ok(monthStored.every(row=>row.received_at===iso()));
eq((await mp(monthBatch(monthPoints))).day.version,monthAccepted.day.version,'A delayed duplicate batch stays idempotent');
await mp(monthBatch([{...monthPoints[0],latitude:target.latitude+0.1}]),409);
await mp(monthBatch([monthPoint('month-wrong-day','2026-09-21T03:00:00.000Z')]),400);
await mp({...monthBatch([monthPoint('wrong-device','2026-09-20T03:00:30.000Z')]),deviceId:crypto.randomUUID()},409);
await mp({action:'samples',dayId:monthCurrent.id,deviceId:monthDevice,points:[monthPoint('month-future',iso(6000))]},400);
user('peer');await mp(monthBatch([monthPoint('foreign-owner','2026-09-20T03:00:30.000Z')]),404);user('month-offline');
const monthGap={action:'gap',dayId:monthDay.id,deviceId:monthDevice,stopId:null,at:'2026-09-20T03:00:30.000Z',reason:'buffer_full'};
const monthGapResult=await mp(monthGap);ok(monthGapResult.day.gaps.some(gap=>gap.reason==='buffer_full'&&gap.from==='2026-09-20T03:00:15.000Z'&&gap.to===monthGap.at));eq((await mp(monthGap)).day.version,monthGapResult.day.version,'Month-old buffer-full gap retries do not duplicate evidence');eq(stopRaw(monthSelected.id),monthStopBefore);
await mp({...monthGap,at:'2026-09-21T03:00:30.000Z'},400);
sql.prepare("UPDATE crm_members SET role='customer_service' WHERE id='month-offline'").run();await mp(monthBatch([monthPoint('wrong-role','2026-09-20T03:00:45.000Z')]),403);await mp(monthBegin,403);sql.prepare("UPDATE crm_members SET role='rep',region_scope='western' WHERE id='month-offline'").run();await mp(monthBatch([monthPoint('wrong-region','2026-09-20T03:00:45.000Z')]),403);await mp(monthGap,403);sql.prepare("UPDATE crm_members SET region_scope='eastern' WHERE id='month-offline'").run();
const monthCount=dbCount('crm_mobile_route_points');race=()=>sql.prepare("UPDATE crm_members SET active=0 WHERE id='month-offline'").run();await mp(monthBatch([monthPoint('late-revocation','2026-09-20T03:00:45.000Z')]),409);eq(dbCount('crm_mobile_route_points'),monthCount);sql.prepare("UPDATE crm_members SET active=1 WHERE id='month-offline'").run();
user('supervisor');const monthReport=await get('?date=2026-09-20&memberId=month-offline');eq(monthReport.mobileDays[0].points.map(point=>point.capturedAt),monthPoints.map(point=>point.capturedAt));eq(monthReport.mobileDays[0].deviceId,undefined);

// A newly-created account cannot invent a pre-enrollment interval, including on
// its first Saudi calendar day. The server clamps legacy midnight starts exactly.
member('enrollment','rep','supervisor','eastern',1,'2026-09-20T08:00:00.000Z');user('enrollment');const enrollmentDevice=crypto.randomUUID();
const enrollmentBegin={...begin(enrollmentDevice),continuous:true,date:'2026-09-20',startedAt:'2026-09-19T21:00:00.000Z',regionScope:'eastern'};
await mp({...enrollmentBegin,date:'2026-09-19',startedAt:'2026-09-19T03:00:00.000Z'},400);
const enrollmentDay=(await mp(enrollmentBegin)).day;eq(enrollmentDay.startedAt,'2026-09-20T08:00:00.000Z');
await mp({action:'samples',dayId:enrollmentDay.id,deviceId:enrollmentDevice,points:[monthPoint('pre-enrollment','2026-09-20T07:59:59.000Z')]},400);
await mp({action:'gap',dayId:enrollmentDay.id,deviceId:enrollmentDevice,at:'2026-09-20T07:59:59.000Z',stopId:null,reason:'gps_unavailable'},400);
await mp({action:'samples',dayId:enrollmentDay.id,deviceId:enrollmentDevice,points:[monthPoint('first-enrolled','2026-09-20T08:00:00.000Z')]});
const beforeEnrollmentRace=dbCount('crm_mobile_route_days');race=()=>sql.prepare("UPDATE crm_members SET created_at='2026-09-22T08:00:00.000Z' WHERE id='enrollment'").run();await mp({...enrollmentBegin,createKey:crypto.randomUUID(),date:'2026-09-21',startedAt:'2026-09-21T03:00:00.000Z'},409);eq(dbCount('crm_mobile_route_days'),beforeEnrollmentRace,'The enrollment boundary is rechecked in the guarded write');
// A pre-existing saved day stays replayable if enrollment metadata is corrected:
// its owner, device, role and current region are still checked at upload time.
eq((await mp(enrollmentBegin)).day.id,enrollmentDay.id);await mp({action:'samples',dayId:enrollmentDay.id,deviceId:enrollmentDevice,points:[monthPoint('saved-day-tail','2026-09-20T08:00:15.000Z')]});
member('riyadh-enrollment','rep','supervisor','eastern',1,'2026-09-19T22:00:00.000Z');user('riyadh-enrollment');const riyadhDevice=crypto.randomUUID();
await mp({...begin(riyadhDevice),date:'2026-09-19',startedAt:'2026-09-19T14:00:00.000Z',regionScope:'eastern'},400);
eq((await mp({...begin(riyadhDevice),date:'2026-09-20',startedAt:'2026-09-19T21:00:00.000Z',regionScope:'eastern'})).day.startedAt,'2026-09-20T03:00:00.000Z','Enrollment calendar boundary uses Saudi time and still observes 06:00 opening');
eq(sql.prepare('PRAGMA foreign_key_check').all(),[]);
console.log(JSON.stringify({suite:'mobile-route',checks,passed:true}));

