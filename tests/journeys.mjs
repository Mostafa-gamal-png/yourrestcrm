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
for(const name of ['journeys','visits','customer-followups'])compile('app/api/'+name+'/route.ts');
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
const day='2026-09-30';
function member(id,role,supervisor='',region='eastern',active=1){sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,?,0,?)').run(id,'u-'+id,id+'@yourrest.org',id,role,'الرئيسي',supervisor||null,region,active,iso());}
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
const journeys=await api('journeys'),visits=await api('visits'),followups=await api('customer-followups');
const engine=await import(path.join(out,'lib/journeys.mjs'));
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const ok=(actual,message)=>{assert.ok(actual,message);checks++;};
function request(body,headers={}){return new Request('https://test.invalid/api/journeys',{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json',...headers},body:JSON.stringify(body)});}
async function post(body,status=200,route=journeys){const response=await route.POST(request(body));const payload=await response.json();eq(response.status,status,JSON.stringify(payload));return payload;}
async function get(query='',status=200){const response=await journeys.GET(new Request('https://test.invalid/api/journeys'+query));const payload=await response.json();eq(response.status,status,JSON.stringify(payload));return payload;}
const rawRecord=id=>sql.prepare('SELECT * FROM crm_records WHERE id=?').get(id);
const record=id=>({...rawRecord(id),data:JSON.parse(rawRecord(id).data)});

// Journey contract tests follow below.
const target={latitude:26.437341,longitude:50.034499};
const baseTime='2026-09-30T09:00:00.000Z';
const at=seconds=>new Date(NativeDate.parse(baseTime)+seconds*1000).toISOString();
function point(seconds,meters=0,accuracy=10,id='p-'+seconds){return {id,capturedAt:at(seconds),latitude:target.latitude+meters/111194.9266,longitude:target.longitude,accuracy};}
function fresh(id='engine',coordinates=target){return {id,memberId:'rep',date:day,customerId:'factory',regionScope:'eastern',snapshot:{customerName:'Factory',region:'الشرقية',latitude:coordinates?.latitude??null,longitude:coordinates?.longitude??null},selectedAt:baseTime,closedAt:null,state:'en_route',data:engine.initialJourneyData(baseTime),version:1};}
function feed(stop,...points){return points.reduce((current,p)=>engine.applyJourneyPoint(current,p),stop);}
function throws(callback,pattern,message){assert.throws(callback,pattern,message);checks++;}

// Physical timing is confirmed from two accurate observations, never from form time.
const original=fresh();let trip=feed(original,point(0,600),point(15),point(29));
eq(original.data.lastPoint,undefined,'The engine does not mutate persisted input');
eq(trip.state,'en_route','An arrival candidate needs at least 15 seconds');
trip=feed(trip,point(30));eq(trip.state,'onsite');eq(trip.data.arrivalAt,at(15),'Arrival uses the first confirmed candidate');
trip=feed(trip,point(45),point(60,300),point(74,300));eq(trip.state,'onsite','An exit candidate also needs confirmation');
trip=feed(trip,point(75,300));eq(trip.state,'completed');eq(trip.data.departureAt,at(60));eq(trip.closedAt,at(60));eq(trip.data.durationSeconds,45,'Duration is arrival to observed exit');
eq(trip.data.durationUncertain,false);eq(trip.data.events.map(event=>event.type),['selected','arrival','departure']);
throws(()=>feed(trip,point(90,300)),/JOURNEY_CLOSED/);
const timing=engine.journeyVisitTiming(trip);eq(timing.startedAt,at(15));eq(timing.endedAt,at(60));eq(timing.durationSeconds,45);eq(timing.timingSource,'journey');

// Accuracy and the uncertainty band cannot create a visit.
trip=feed(fresh(),point(0,145,10),point(15,145,10));eq(trip.data.arrivalAt,null,'Accuracy circle must fit inside the entry radius');
trip=feed(fresh(),point(0,0,76),point(15,0,76));eq(trip.data.arrivalAt,null,'Poor GPS accuracy is not an arrival');
trip=feed(fresh(),point(0),point(10,200),point(15));eq(trip.data.arrivalAt,null,'Leaving the entry radius resets the candidate');
trip=feed(trip,point(30));eq(trip.data.arrivalAt,at(15));
trip=feed(trip,point(45,230,10),point(60,230,10));eq(trip.data.departureAt,null,'Accuracy circle must lie beyond the exit radius');
trip=feed(fresh('missing',null),point(0),point(15),point(30,300));eq(trip.state,'en_route');eq(trip.data.arrivalAt,null);eq(trip.data.departureAt,null);eq(trip.data.durationSeconds,null);
throws(()=>feed(feed(fresh(),point(15)),point(15)),/POINT_OUT_OF_ORDER/);throws(()=>feed(feed(fresh(),point(15)),point(10)),/POINT_OUT_OF_ORDER/);

// Missing observations break confirmation and prevent a falsely exact duration.
trip=feed(fresh(),point(0),point(121));eq(trip.state,'en_route');eq(trip.data.arrivalAt,null);eq(trip.data.gaps.length,1);
trip=feed(fresh(),point(0),point(15),point(136),point(151,300),point(166,300));eq(trip.state,'completed');eq(trip.data.durationUncertain,true);eq(trip.data.durationSeconds,null);ok(trip.data.observedSeconds>=15,'Known observation time remains distinct from exact duration');
trip=feed(fresh(),point(0),point(15),point(30,0,90),point(45,300),point(60,300));eq(trip.state,'completed');eq(trip.data.durationUncertain,true);eq(trip.data.durationSeconds,null);
const interrupted=engine.closeJourney(feed(fresh(),point(0),point(15)),at(60),'customer_changed');eq(interrupted.state,'interrupted');eq(interrupted.data.departureAt,null);eq(interrupted.data.durationSeconds,null);eq(interrupted.data.durationUncertain,true);eq(interrupted.data.events.at(-1).reason,'customer_changed');
const ended=engine.closeJourney(fresh(),at(30));eq(ended.state,'interrupted');eq(ended.data.arrivalAt,null);eq(ended.data.departureAt,null);eq(ended.data.durationSeconds,null);
const marked=engine.journeyGap(feed(fresh(),point(0),point(15)),at(30),'app_hidden');eq(marked.data.durationUncertain,true);eq(marked.data.gaps.at(-1).reason,'app_hidden');eq(marked.data.candidate,undefined);
eq(engine.journeySegments([point(0),point(15),point(136),point(151)]).map(segment=>segment.map(p=>p.id)),[['p-0','p-15'],['p-136','p-151']]);
eq(engine.journeySegments([point(0),point(15,0,90),point(30),point(45)]).map(segment=>segment.map(p=>p.id)),[['p-0'],['p-30','p-45']]);
eq(engine.journeySegments([point(0),point(15),point(30)], [{from:at(15),to:at(30),reason:'offline'}]).map(segment=>segment.map(p=>p.id)),[['p-0','p-15'],['p-30']]);
eq(engine.journeyDate('2026-09-30T20:59:59.999Z'),'2026-09-30');eq(engine.journeyDate('2026-09-30T21:00:00.000Z'),'2026-10-01');

// Authenticated API applies the same engine using bounded, ordered device data.
user(null);await get('',401);await post({action:'select',customerId:'factory',createKey:crypto.randomUUID()},401);
user('service');await get('',403);await get('?date='+day,403);await post({action:'select',customerId:'factory',createKey:crypto.randomUUID()},403);
user('inactive');await get('',403);
user('rep');await get('?date='+day,403);await get('?date='+day+'&memberId=rep',403);
const forbiddenOrigin=await journeys.POST(request({action:'select',customerId:'factory',createKey:crypto.randomUUID()},{origin:'https://evil.invalid'}));eq(forbiddenOrigin.status,403);
const malformed=await journeys.POST(new Request('https://test.invalid/api/journeys',{method:'POST',headers:{origin:'https://test.invalid'},body:'not-json'}));eq(malformed.status,400);
await post({action:'select',customerId:'west',createKey:crypto.randomUUID()},403);
const key=crypto.randomUUID(),selection={action:'select',customerId:'factory',createKey:key};
let selected=await post(selection),active=selected.active;ok(active);eq(active.memberId,'rep');eq(active.date,day);eq(active.customerId,'factory');eq(active.state,'en_route');eq(active.snapshot.latitude,target.latitude);eq(active.snapshot.longitude,target.longitude);
eq((await post(selection)).active.id,active.id,'A selection retry is idempotent');
eq((await post({...selection,createKey:crypto.randomUUID()})).active.id,active.id,'Selecting the same current customer does not duplicate the stop');
await post({...selection,customerId:'second'},409);
eq(sql.prepare('SELECT COUNT(*) AS n FROM crm_journey_stops WHERE member_id=\'rep\'').get().n,1);
const activeResponse=await journeys.GET(new Request('https://test.invalid/api/journeys'));eq(activeResponse.headers.get('cache-control'),'no-store');eq((await activeResponse.json()).active.id,active.id);
const samples=(points,stopId=active.id)=>({action:'samples',stopId,points});
for(const invalid of [point(6),point(-1),{...point(0),latitude:91},{...point(0),longitude:181},{...point(0),accuracy:-1},{...point(0),latitude:0,longitude:0},{...point(0),secret:'extra'},{...point(0),id:''}])await post(samples([invalid]),400);
await post(samples([]),400);await post(samples(Array.from({length:51},(_,index)=>point(0,0,10,'large-'+index))),400);
await post(samples([point(0),point(0)]),400);
eq(sql.prepare('SELECT COUNT(*) AS n FROM crm_journey_points').get().n,0,'Rejected samples never write partial evidence');
// Arrival evidence is linked before exit, and updated when the rep physically leaves.
clock=NativeDate.parse(at(30));let saved=await post(samples([point(0,600),point(15),point(30)]));eq(saved.active.state,'onsite');eq(saved.active.data.arrivalAt,at(15));
eq((await post(samples([point(0,600),point(15),point(30)]))).active.version,saved.active.version,'Exact GPS retries have no extra version or point writes');
eq(sql.prepare('SELECT COUNT(*) AS n FROM crm_journey_points WHERE stop_id=?').get(active.id).n,3);
await post(samples([{...point(30),latitude:target.latitude+0.1}]),409);await post(samples([{...point(30),id:'alternate-id'}]),409);await post(samples([point(20)]),409);
user('peer');await post(samples([point(30)]),404);await post({action:'end',reason:'contact_type_changed',stopId:active.id},404);user('owner');await post(samples([point(30)]),404);user('rep');
function visitBody(customerId='factory',extra={}){
 return {createKey:crypto.randomUUID(),customerId,customerVersion:rawRecord(customerId).version,timingMode:'automatic',elapsedMilliseconds:2700000,data:{type:'visit',date:day,summary:'تعريف بمنتجات الشركة',result:'متابعة العميل',salesStage:'new',strength:'strong',nextAction:'متابعة المواصفات',nextDate:day,requestedProducts:['قوالب البلوك المتحركة'],location:target.latitude+', '+target.longitude,locationSource:'device',locationCapturedAt:iso(),locationAccuracy:10},...extra};
}
function followupBody(sourceId,extra={}){
 return {createKey:crypto.randomUUID(),customerId:'factory',customerVersion:rawRecord('factory').version,sourceId,sourceVersion:sourceId?rawRecord(sourceId).version:undefined,data:{type:'call',date:day,result:'تمت متابعة مواصفات القالب',salesStage:'specs',invoiceOutcome:'pending',nextAction:'تحديد المواصفات',nextDate:day},...extra};
}
// Accurate form GPS may save independently of tracker activation/synchronization.
// Even an open, onsite stop for the same customer is never implicitly selected.
let body=visitBody();const standalone=(await post(body,200,visits)).id;
eq(record(standalone).data.journeyStopId,undefined,'No stop hint means a standalone form visit');
eq(record(standalone).data.timingSource,'form');
eq(record(standalone).data.startedAt,iso(-body.elapsedMilliseconds));
eq(record(standalone).data.endedAt,iso());
eq(record(standalone).data.durationSeconds,2700);
eq(sql.prepare('SELECT COUNT(*) AS n FROM crm_journey_links WHERE activity_id=?').get(standalone).n,0,'An older active stop cannot claim this contact');
const standaloneBefore=rawRecord(standalone);
body=visitBody();body.data.journeyStopId=active.id;const visitSaved=await post(body,200,visits),visitId=visitSaved.id;
eq(record(visitId).data.journeyStopId,active.id);eq(record(visitId).data.timingSource,'journey');eq(record(visitId).data.startedAt,at(15));eq(record(visitId).data.endedAt,'');eq(record(visitId).data.durationSeconds,null,'An ongoing arrival is not a completed form-duration visit');
eq(record(visitId).data.durationReview,true);eq(record(visitId).data.performedBy,'rep');
eq((await post(body,200,visits)).alreadySaved,true);eq(sql.prepare('SELECT COUNT(*) AS n FROM crm_journey_links WHERE activity_id=?').get(visitId).n,1);
let originalVersion=rawRecord(visitId).version;
// Calls may carry the same stop's outcome but must never inherit physical arrival/exit timing.
body=followupBody(visitId);body.data.journeyStopId=active.id;const callSaved=await post(body,200,followups),callId=callSaved.id;
eq(record(callId).data.journeyStopId,active.id);eq(record(callId).data.timingSource,undefined);eq(record(callId).data.startedAt,undefined);eq(record(callId).data.endedAt,undefined);
clock=NativeDate.parse(at(45));await post(samples([point(45)]));eq(rawRecord(visitId).version,originalVersion,'A routine onsite heartbeat leaves an open edit version stable');
clock=NativeDate.parse(at(90));const tail=[point(45),point(60,300),point(75,300),point(90,600)];
saved=await post(samples(tail));eq(saved.active,null);eq(saved.stop.state,'completed');eq(saved.stop.data.durationSeconds,45);
eq(record(visitId).data.startedAt,at(15));eq(record(visitId).data.endedAt,at(60));eq(record(visitId).data.durationSeconds,45);ok(rawRecord(visitId).version>originalVersion,'Observed exit updates the linked visit optimistic version');
eq(record(callId).data.startedAt,undefined);eq(record(callId).data.endedAt,undefined);eq(rawRecord(callId).version,1,'GPS updates must not mutate a call');
eq(rawRecord(standalone),standaloneBefore,'Later geographic evidence must not rewrite an unlinked form visit');
eq((await post(samples(tail))).stop.id,active.id,'Retry after a lost auto-exit response safely handles unrecorded batch tail');
eq((await get()).active,null);
// A late-saved result still links to the exact selected stop even after automatic departure.
body=visitBody();body.data.journeyStopId=active.id;body.data.result='تم تأكيد طلب العميل بعد المغادرة';const lateSaved=await post(body,200,visits);eq(record(lateSaved.id).data.journeyStopId,active.id);eq(record(lateSaved.id).data.durationSeconds,45);
body=visitBody();body.data.journeyStopId=active.id;body.customerId='second';body.customerVersion=rawRecord('second').version;await post(body,403,visits);
user('peer');body=visitBody();body.data.journeyStopId=active.id;await post(body,403,visits);user('rep');
const planModule=await import(path.join(out,'lib/customer-followups.mjs'));const currentPlanSource=planModule.latestCustomerContact('factory',sql.prepare('SELECT id FROM crm_records').all().map(r=>{const raw=record(r.id);return {...raw,parentId:raw.parent_id,assignedTo:raw.assigned_to,createdAt:raw.created_at,updatedAt:raw.updated_at};}));body=followupBody(currentPlanSource.id);body.data.date='2026-09-29';body.data.journeyStopId=active.id;await post(body,400,followups);
body=visitBody();const untracked=await post(body,200,visits);eq(record(untracked.id).data.journeyStopId,undefined);eq(record(untracked.id).data.timingSource,'form','An unlinked legacy form timer is explicitly marked');
// A supervisor can correct an existing result without changing the original geographic evidence.
user('supervisor');body=visitBody();body.id=visitId;body.version=rawRecord(visitId).version;body.data={...record(visitId).data,result:'راجع المشرف نتيجة الزيارة'};await post(body,200,visits);eq(record(visitId).data.performedBy,'rep');eq(record(visitId).data.journeyStopId,active.id);eq(record(visitId).data.startedAt,at(15));eq(record(visitId).data.durationSeconds,45);
body=visitBody();body.id=visitId;body.version=rawRecord(visitId).version;body.data={...record(visitId).data,type:'call'};await post(body,400,visits);
let report=await get('?date='+day+'&memberId=rep');eq(report.stops.length,1);eq(report.stops[0].results.map(result=>result.id).sort(),[visitId,callId,lateSaved.id].sort());eq(report.stops[0].data.durationSeconds,45);ok(report.stops[0].points.every(p=>p.receivedAt),'Every device observation retains the server receipt time');
ok(report.members.every(m=>Object.keys(m).sort().join(',')==='active,id,name,role'),'Report member labels contain no targets or employee profile fields');
await get('?date=not-a-date&memberId=rep',400);await get('?date=2026-02-30&memberId=rep',400);await get('?date='+day+'&memberId=outsider',403);

// Incomplete legs, missing coordinates, explicit gaps and day changes are reported honestly.
user('rep');clock=NativeDate.parse(at(100));selected=await post({action:'select',customerId:'second',createKey:crypto.randomUUID()});const changedStop=selected.active.id;
clock=NativeDate.parse(at(130));await post({action:'samples',stopId:changedStop,points:[point(100),point(115),point(130)]});
selected=await post({action:'select',customerId:'no-location',createKey:crypto.randomUUID()});const missingStop=selected.active.id;
const storedStop=id=>{const row=sql.prepare('SELECT * FROM crm_journey_stops WHERE id=?').get(id);return {...row,snapshot:JSON.parse(row.snapshot),data:JSON.parse(row.data)};};
eq(storedStop(changedStop).state,'interrupted');eq(storedStop(changedStop).data.arrivalAt,at(100));eq(storedStop(changedStop).data.departureAt,null);eq(storedStop(changedStop).data.durationSeconds,null);eq(storedStop(changedStop).data.events.at(-1).reason,'customer_changed');
clock=NativeDate.parse(at(160));await post({action:'samples',stopId:missingStop,points:[point(130),point(145),point(160,300)]});eq(storedStop(missingStop).data.arrivalAt,null);
await post({action:'end',reason:'manual_end',stopId:missingStop},403);await post({action:'end',reason:'day_end',stopId:missingStop},403);
const endedResult=await post({action:'end',reason:'contact_type_changed',stopId:missingStop});eq(endedResult.stop.state,'interrupted');eq(endedResult.active,null);eq(endedResult.stop.data.departureAt,null);eq((await post({action:'end',reason:'contact_type_changed',stopId:missingStop})).stop.version,endedResult.stop.version,'Ending twice is harmless');
selected=await post({action:'select',customerId:'factory',createKey:crypto.randomUUID()});const gapStop=selected.active.id;
clock=NativeDate.parse(at(175));await post({action:'samples',stopId:gapStop,points:[point(160),point(175)]});
clock=NativeDate.parse(at(305));let gapActive=(await get()).active;eq(gapActive.data.durationUncertain,true);ok(gapActive.data.gaps.some(gap=>gap.reason==='no_recent_location'),'A stalled device is visible before a new sample arrives');
clock=NativeDate.parse(at(335));await post({action:'samples',stopId:gapStop,points:[point(305),point(320,300),point(335,300)]});eq(storedStop(gapStop).state,'completed');eq(storedStop(gapStop).data.durationUncertain,true);eq(storedStop(gapStop).data.durationSeconds,null);
selected=await post({action:'select',customerId:'factory',createKey:crypto.randomUUID()});const explicitGap=selected.active.id;
clock=NativeDate.parse(at(350));await post({action:'samples',stopId:explicitGap,points:[point(335),point(350)]});await post({action:'gap',stopId:explicitGap,reason:'permission_denied'});eq(storedStop(explicitGap).data.durationUncertain,true);eq(storedStop(explicitGap).data.gaps.at(-1).reason,'permission_denied');await post({action:'gap',stopId:explicitGap,reason:'invented'},400);
await post({action:'end',reason:'contact_type_changed',stopId:explicitGap});

// Reporting scope uses the current hierarchy and both snapshot and current region.
async function makeStop(memberId,customerId='factory'){
 user(memberId);advance(15000);const stop=(await post({action:'select',customerId,createKey:crypto.randomUUID()})).active;advance(15000);await post({action:'samples',stopId:stop.id,points:[{id:'scope-'+memberId,capturedAt:iso(),...target,accuracy:10}]});await post({action:'end',reason:'contact_type_changed',stopId:stop.id});return stop.id;
}
const fixtures={};for(const id of ['owner','manager','other-manager','supervisor','other-supervisor','peer','outsider'])fixtures[id]=await makeStop(id);
fixtures.western=await makeStop('western','west');
sql.prepare("UPDATE crm_members SET active=1 WHERE id='inactive'").run();fixtures.inactive=await makeStop('inactive');sql.prepare("UPDATE crm_members SET active=0 WHERE id='inactive'").run();
user('supervisor');report=await get('?date='+day+'&memberId=all');eq([...new Set(report.stops.map(stop=>stop.memberId))].sort(),['inactive','peer','rep','supervisor']);ok(!JSON.stringify(report).includes(fixtures.outsider));ok(!report.stops.some(stop=>stop.customerId==='west'));
user('manager');report=await get('?date='+day+'&memberId=all');eq([...new Set(report.stops.map(stop=>stop.memberId))].sort(),['inactive','manager','other-supervisor','outsider','peer','rep','supervisor']);ok(!report.stops.some(stop=>['owner','other-manager','western'].includes(stop.memberId)));
user('owner');report=await get('?date='+day+'&memberId=all');ok(report.stops.some(stop=>stop.memberId==='western'));ok(report.stops.some(stop=>stop.memberId==='owner'));
// Transferring a rep changes the supervisor's report on the next request.
sql.prepare("UPDATE crm_members SET supervisor_id='other-supervisor' WHERE id='rep'").run();user('supervisor');await get('?date='+day+'&memberId=rep',403);report=await get('?date='+day+'&memberId=all');ok(!report.stops.some(stop=>stop.memberId==='rep'));user('other-supervisor');report=await get('?date='+day+'&memberId=rep');ok(report.stops.length>0);sql.prepare("UPDATE crm_members SET supervisor_id='supervisor' WHERE id='rep'").run();
// Current customer relocation hides history from the former territory. Snapshot protects the new one.
sql.prepare("UPDATE crm_records SET data=json_set(data,'$.region','الغربية'),version=version+1 WHERE id='factory'").run();
user('supervisor');report=await get('?date='+day+'&memberId=all');ok(!report.stops.some(stop=>stop.customerId==='factory'));ok(!JSON.stringify(report).includes(active.id));
sql.prepare("UPDATE crm_members SET region_scope='western' WHERE id='supervisor'").run();report=await get('?date='+day+'&memberId=all');ok(!report.stops.some(stop=>stop.customerId==='factory'),'New region cannot read old snapshot location');ok(report.stops.some(stop=>stop.customerId==='west'));
sql.prepare("UPDATE crm_members SET region_scope='eastern' WHERE id='supervisor'").run();sql.prepare("UPDATE crm_records SET data=json_set(data,'$.region','الشرقية'),version=version+1 WHERE id='factory'").run();

// Calls and followups remain visible on a day with no GPS stop, under the same scope.
function communication(id,author,customerId='factory',contactDate=day){
 const data={type:'call',date:contactDate,summary:'Phone contact '+id,result:'Private result '+id,performedBy:author,recordedByEmail:author+'@yourrest.org',nextAction:'Review specification',nextDate:day};
 sql.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'activity',?,'owner','الرئيسي',?,?,?,1,'fixture')").run(id,customerId,JSON.stringify(data),iso(),iso());
}
for(const id of ['rep','peer','outsider','other-manager','owner'])communication('call-only-'+id,id);
communication('call-only-west','rep','west');communication('call-yesterday','rep','factory','2026-09-29');
user('supervisor');report=await get('?date='+day+'&memberId=rep');ok(report.communications.some(item=>item.id==='call-only-rep'));ok(report.communications.some(item=>item.id===untracked.id));ok(report.communications.every(item=>item.memberId==='rep'));ok(!report.communications.some(item=>['call-only-west','call-yesterday',visitId,callId].includes(item.id)));
report=await get('?date='+day+'&memberId=all');ok(report.communications.some(item=>item.id==='call-only-peer'));ok(!report.communications.some(item=>['call-only-outsider','call-only-other-manager','call-only-owner'].includes(item.id)));
user('manager');report=await get('?date='+day+'&memberId=all');ok(report.communications.some(item=>item.id==='call-only-outsider'));ok(!report.communications.some(item=>['call-only-other-manager','call-only-owner'].includes(item.id)));
user('supervisor');report=await get('?date=2026-09-29&memberId=rep');eq(report.stops.length,0);eq(report.communications.map(item=>item.id),['call-yesterday'],'A call-only working day is not an empty report');

// Authorization and optimistic state are rechecked within the same write transaction.
user('rep');let mutable=(await post({action:'select',customerId:'factory',createKey:crypto.randomUUID()})).active;
const stopBefore=storedStop(mutable.id),pointCount=sql.prepare('SELECT COUNT(*) AS n FROM crm_journey_points').get().n;
advance(15000);race=()=>sql.prepare("UPDATE crm_members SET region_scope='western' WHERE id='rep'").run();await post({action:'samples',stopId:mutable.id,points:[{id:'revoked',capturedAt:iso(),...target,accuracy:10}]},409);
eq(storedStop(mutable.id),stopBefore);eq(sql.prepare('SELECT COUNT(*) AS n FROM crm_journey_points').get().n,pointCount);
eq((await get()).active,null);await post({action:'samples',stopId:mutable.id,points:[{id:'revoked-again',capturedAt:iso(),...target,accuracy:10}]},403);sql.prepare("UPDATE crm_members SET region_scope='eastern' WHERE id='rep'").run();
race=()=>sql.prepare("UPDATE crm_records SET data=json_set(data,'$.region','الغربية'),version=version+1 WHERE id='factory'").run();await post({action:'samples',stopId:mutable.id,points:[{id:'customer-moved',capturedAt:iso(),...target,accuracy:10}]},409);eq(storedStop(mutable.id),stopBefore);sql.prepare("UPDATE crm_records SET data=json_set(data,'$.region','الشرقية'),version=version+1 WHERE id='factory'").run();
// A result cannot be attached if the selected stop changes while the visit commits.
body=visitBody();body.data.journeyStopId=mutable.id;race=()=>sql.prepare('UPDATE crm_journey_stops SET version=version+1 WHERE id=?').run(mutable.id);await post(body,409,visits);eq(rawRecord('customer-visit-'+body.createKey),undefined);eq(sql.prepare('SELECT COUNT(*) AS n FROM crm_journey_links WHERE activity_id=?').get('customer-visit-'+body.createKey).n,0);
// Relocated previous legs may be closed to permit a new allowed customer; private old outcomes must not change.
body=visitBody();body.data.journeyStopId=mutable.id;const protectedVisit=(await post(body,200,visits)).id,protectedBefore=rawRecord(protectedVisit);
sql.prepare("UPDATE crm_records SET data=json_set(data,'$.region','الغربية'),version=version+1 WHERE id='factory'").run();selected=await post({action:'select',customerId:'second',createKey:crypto.randomUUID()});eq(selected.active.customerId,'second');eq(rawRecord(protectedVisit),protectedBefore,'Selecting another allowed customer does not rewrite an inaccessible old outcome');
sql.prepare("UPDATE crm_records SET data=json_set(data,'$.region','الشرقية'),version=version+1 WHERE id='factory'").run();await post({action:'end',reason:'contact_type_changed',stopId:selected.active.id});

// The server bounds replay and validates Riyadh workdays independently of device claims.
mutable=(await post({action:'select',customerId:'factory',createKey:crypto.randomUUID()})).active;const selectedTime=clock;advance(16*60000);
await post({action:'samples',stopId:mutable.id,points:[{id:'expired',capturedAt:new Date(selectedTime).toISOString(),...target,accuracy:10}]},400);
await post({action:'samples',stopId:mutable.id,points:[{id:'future',capturedAt:iso(6000),...target,accuracy:10}]},400);
await post({action:'samples',stopId:mutable.id,points:[{id:'replay-valid',capturedAt:iso(-14*60000),...target,accuracy:10}]});eq(storedStop(mutable.id).data.lastPoint.receivedAt,iso());
await post({action:'end',reason:'contact_type_changed',stopId:mutable.id});
clock=NativeDate.parse('2026-09-30T14:59:20.000Z');mutable=(await post({action:'select',customerId:'factory',createKey:crypto.randomUUID()})).active;
advance(15000);await post({action:'samples',stopId:mutable.id,points:[{id:'midnight-1',capturedAt:iso(-15000),...target,accuracy:10},{id:'midnight-2',capturedAt:iso(),...target,accuracy:10}]});
clock=NativeDate.parse('2026-09-30T15:00:00.000Z');body=visitBody();body.elapsedMilliseconds=5000;
const afterHours=(await post(body,200,visits)).id;
eq(record(afterHours).data.journeyStopId,undefined,'A projected 18:00 closure must not be silently inferred');
eq(record(afterHours).data.timingSource,'form');eq(record(afterHours).data.durationSeconds,5);
eq(sql.prepare('SELECT COUNT(*) AS n FROM crm_journey_links WHERE activity_id=?').get(afterHours).n,0);
clock=NativeDate.parse('2026-09-30T21:00:01.000Z');eq((await get()).active,null,'A yesterday leg never resumes as today active');
await post({action:'samples',stopId:mutable.id,points:[{id:'cross-day',capturedAt:iso(),...target,accuracy:10}]},400);
user('supervisor');report=await get('?date='+day+'&memberId=rep');const yesterday=report.stops.find(stop=>stop.id===mutable.id);eq(yesterday.state,'interrupted');eq(yesterday.data.departureAt,null);eq(yesterday.data.durationSeconds,null);ok(yesterday.closedAt,'Unclosed previous days display as interrupted');
user('rep');clock=NativeDate.parse('2026-10-01T03:00:00.000Z');const todayStop=(await post({action:'select',customerId:'factory',createKey:crypto.randomUUID()})).active;eq(todayStop.date,'2026-10-01');eq(storedStop(mutable.id).state,'interrupted');eq(storedStop(mutable.id).data.events.at(-1).reason,'tracking_window_ended');
await post({action:'end',reason:'contact_type_changed',stopId:todayStop.id});

// Implausible GPS jumps break evidence and map lines rather than fabricate a visit.
trip=feed(fresh(),point(0),point(15));trip=feed(trip,point(30,100000));eq(trip.data.departureAt,null);eq(trip.data.candidate,undefined);eq(trip.data.durationUncertain,true);ok(trip.data.gaps.some(g=>g.reason==='implausible_location_jump'));
eq(engine.journeySegments([point(0),point(15),point(30,100000),point(45,100000)],trip.data.gaps).map(segment=>segment.map(p=>p.id)),[['p-0','p-15'],['p-30','p-45']]);

// Daily enrichment is a read-only projection of authorized evidence, including
// contacts captured offline and plans that were already due on the selected day.
const reportDay='2026-10-01',capturedOffline='2026-10-01T09:03:00.000Z';
clock=NativeDate.parse('2026-10-03T12:00:00.000Z');
function dailyActivity(id,author,customerId,overrides={},createdAt='2026-09-29T08:00:00.000Z'){
 const data={type:'call',date:createdAt.slice(0,10),summary:'Daily goal '+id,result:'Daily result '+id,performedBy:author,nextAction:'Daily next '+id,nextDate:reportDay,...overrides};
 sql.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'activity',?,'owner','الرئيسي',?,?,?,1,'daily-fixture')").run(id,customerId,JSON.stringify(data),createdAt,createdAt);
}
const dailyCustomers={rep:{latitude:28.5,longitude:49},peer:{latitude:29.5,longitude:49},outsider:{latitude:30.5,longitude:49},western:{latitude:31.5,longitude:49}};
for(const [id,coords] of Object.entries(dailyCustomers))customer('daily-location-'+id,id==='western'?'الغربية':'الشرقية',coords);
sql.prepare("UPDATE crm_records SET created_at='2026-09-29T08:00:00.000Z',updated_at='2026-09-29T08:00:00.000Z' WHERE id LIKE 'daily-location-%'").run();
customer('daily-private-west-customer','الغربية',dailyCustomers.rep);
sql.prepare("UPDATE crm_records SET created_at='2026-09-29T08:00:00.000Z',updated_at='2026-09-29T08:00:00.000Z' WHERE id='daily-private-west-customer'").run();
function dailyMobile(id,memberId,coordinates,region='eastern'){
 const start=reportDay+'T09:00:00.000Z',end=reportDay+'T09:07:00.000Z';
 sql.prepare('INSERT INTO crm_mobile_route_days(id,member_id,device_id,date,region_scope,started_at,ended_at,last_point_at,data,version,mutation_id) VALUES(?,?,?,?,?,?,?,?,?,1,?)').run(id,memberId,'private-device-'+memberId,reportDay,region,start,end,end,JSON.stringify({gaps:[],trackingWindow:'06-18'}),'daily-fixture');
 for(let minute=0;minute<=7;minute++){
  const capturedAt=reportDay+'T09:0'+minute+':00.000Z';
  sql.prepare('INSERT INTO crm_mobile_route_points(day_id,point_id,captured_at,received_at,latitude,longitude,accuracy,stop_id) VALUES(?,?,?,?,?,?,10,NULL)').run(id,id+'-'+minute,capturedAt,iso(),coordinates.latitude+(minute===7?400/111194.9266:0),coordinates.longitude);
 }
}
for(const [id,coords] of Object.entries(dailyCustomers))dailyMobile('daily-route-'+id,id,coords,id==='western'?'western':'eastern');
dailyActivity('daily-offline-visit','rep','daily-location-rep',{type:'visit',date:reportDay,offlineRecordedAt:capturedOffline,nextDate:'2026-10-04',requestedProducts:['قوالب البلوك الثابتة','خلاطات البلوك'],customerNeeds:'مواصفات قالب مسجلة',salesStage:'specs',strength:'strong',hasCompetitor:true,competitorName:'منافس موثق',competitorNotes:'عرض منافس مسجل',competitorFileId:'daily-file',competitorFileName:'competitor.pdf'},'2026-10-02T10:00:00.000Z');
dailyActivity('daily-plain-contact','rep','daily-location-rep',{date:reportDay,hasCompetitor:false,competitorName:'STALE-HIDDEN-COMPETITOR',competitorNotes:'STALE-HIDDEN-NOTES',competitorFileId:'stale-hidden-file',requestedProducts:[],salesStage:'',strength:'',nextDate:'2026-10-04'},'2026-10-01T08:00:00.000Z');
dailyActivity('daily-peer-contact','peer','daily-location-peer',{date:reportDay,nextDate:'2026-10-04'},'2026-10-01T09:03:00.000Z');
dailyActivity('daily-outsider-contact','outsider','daily-location-outsider',{date:reportDay,hasCompetitor:true,competitorName:'OUTSIDE-TEAM-COMPETITOR'},'2026-10-01T09:03:00.000Z');
dailyActivity('daily-west-contact','western','daily-location-western',{date:reportDay,hasCompetitor:true,competitorName:'OUTSIDE-REGION-COMPETITOR'},'2026-10-01T09:03:00.000Z');

for(const id of ['due-rep','due-peer','future-due','closed-stage','closed-flag','superseded','future-source','due-outsider','due-west','due-email','historical-parent'])customer('daily-plan-'+id,id==='due-west'?'الغربية':'الشرقية',{});
dailyActivity('daily-plan-due-rep-source','rep','daily-plan-due-rep',{nextDate:'2026-09-30'});
dailyActivity('daily-plan-due-peer-source','peer','daily-plan-due-peer');
dailyActivity('daily-plan-future-due-source','rep','daily-plan-future-due',{nextDate:'2026-10-02'});
dailyActivity('daily-plan-closed-stage-source','rep','daily-plan-closed-stage',{salesStage:'won'});
dailyActivity('daily-plan-closed-flag-source','rep','daily-plan-closed-flag',{followupStatus:'closed'});
dailyActivity('daily-plan-superseded-old','rep','daily-plan-superseded');
dailyActivity('daily-plan-superseded-current','rep','daily-plan-superseded',{nextDate:'2026-10-05'},'2026-10-01T10:00:00.000Z');
dailyActivity('daily-plan-future-source-before','rep','daily-plan-future-source');
dailyActivity('daily-plan-future-source-after','rep','daily-plan-future-source',{salesStage:'won'},'2026-10-02T10:00:00.000Z');
dailyActivity('daily-plan-due-outsider-source','outsider','daily-plan-due-outsider');
dailyActivity('daily-plan-due-west-source','western','daily-plan-due-west');
dailyActivity('daily-plan-due-email-source','','daily-plan-due-email',{recordedByEmail:'rep@yourrest.org'});
// A later edit of a parent request cannot erase a due historical activity or
// inject the request's future state into the earlier report.
sql.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES('daily-plan-edited-request','opportunity','daily-plan-historical-parent','owner','الرئيسي',?,'2026-09-28T08:00:00.000Z','2026-10-03T10:00:00.000Z',2,'daily-fixture')").run(JSON.stringify({performedBy:'rep',name:'FUTURE-REQUEST-STATE',stage:'won',nextAction:'FUTURE-REQUEST-ACTION',nextDate:'2026-10-03'}));
dailyActivity('daily-plan-historical-child-source','rep','daily-plan-edited-request');
const dailySnapshot=()=>Object.fromEntries(['crm_records','crm_journey_stops','crm_journey_points','crm_journey_links','crm_mobile_route_days','crm_mobile_route_points','crm_audit'].map(table=>[table,sql.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));
const beforeDailyRead=dailySnapshot();
user('supervisor');report=await get('?date='+reportDay+'&memberId=rep');
ok(report.daily,'Daily report enrichment is present in the authenticated API');
eq(Object.keys(report.daily).sort(),['automaticStations','pendingFollowups','summary']);
ok(report.daily.automaticStations.every(stop=>stop.memberId==='rep'),'A selected representative report includes only that representative');
eq(report.daily.automaticStations.length,1);
const matchedStation=report.daily.automaticStations[0];
eq(matchedStation.customerId,'daily-location-rep');eq(matchedStation.matchStatus,'matched');
eq(matchedStation.results.map(result=>result.id),['daily-offline-visit'],'Offline event time associates the actual visit with the observed dwell');
eq(matchedStation.observedDurationSeconds,360,'Observed dwell preserves the six minute GPS evidence');
eq(report.daily.summary.confirmedVisitSeconds,0,'An inferred factory presence does not invent confirmed completed visit duration');
ok(report.daily.summary.observedMovementSeconds>0,'Observed movement is summarized from continuous valid GPS pairs');
eq(report.daily.summary.firstMovementAt,reportDay+'T09:07:00.000Z','First detected movement uses a displaced sample, not the start of recording');
const offlineContact=report.communications.find(item=>item.id==='daily-offline-visit');
ok(offlineContact);eq(offlineContact.createdAt,'2026-10-02T10:00:00.000Z');eq(offlineContact.recordedAt,capturedOffline,'Device recording time and server creation time remain distinct');
eq(offlineContact.requestedProducts,['قوالب البلوك الثابتة','خلاطات البلوك']);eq(offlineContact.customerNeeds,'مواصفات قالب مسجلة');eq(offlineContact.salesStage,'specs');eq(offlineContact.strength,'strong');
eq(offlineContact.hasCompetitor,true);eq(offlineContact.competitorName,'منافس موثق');eq(offlineContact.competitorNotes,'عرض منافس مسجل');eq(offlineContact.competitorFileId,'daily-file');eq(offlineContact.competitorFileName,'competitor.pdf');
const plainContact=report.communications.find(item=>item.id==='daily-plain-contact');
eq(plainContact.requestedProducts,[]);eq(plainContact.salesStage,'');eq(plainContact.strength,'');eq(plainContact.hasCompetitor,false);eq(plainContact.competitorName,undefined);eq(plainContact.competitorFileId,undefined);
ok(!JSON.stringify(report).includes('STALE-HIDDEN'),'Inactive competitor fields cannot appear as actual competitor evidence');
const pendingIds=report.daily.pendingFollowups.filter(item=>item.id.startsWith('daily-plan-')).map(item=>item.id).sort();
eq(pendingIds,['daily-plan-due-email-source','daily-plan-due-rep-source','daily-plan-future-source-before','daily-plan-historical-child-source'],'Only due open plans, before the report cutoff and after supersession, remain');
eq(report.daily.pendingFollowups.find(item=>item.id==='daily-plan-historical-child-source')?.customerId,'daily-plan-historical-parent','Historical activities retain authorized customer ancestry through a request edited later');
ok(!JSON.stringify(report.daily.pendingFollowups).includes('FUTURE-REQUEST'),'Future request state does not enter the historical plan projection');
ok(report.daily.pendingFollowups.every(item=>item.memberId==='rep'),'Plan responsibility follows the source recorder, not the customer assigned owner');
ok(report.daily.pendingFollowups.every(item=>item.nextDate<=reportDay),'Future deadlines are not overdue on a historical report');
for(const privateValue of ['daily-route-peer','daily-route-outsider','daily-route-western','daily-peer-contact','daily-outsider-contact','daily-west-contact','daily-private-west-customer','OUTSIDE-TEAM-COMPETITOR','OUTSIDE-REGION-COMPETITOR','private-device-'])ok(!JSON.stringify(report).includes(privateValue),'No out-of-scope or private device evidence: '+privateValue);

report=await get('?date='+reportDay+'&memberId=all');
eq([...new Set(report.daily.automaticStations.map(stop=>stop.memberId))].sort(),['peer','rep'],'All mode stays within the supervisor team and region');
ok(report.daily.pendingFollowups.some(item=>item.id==='daily-plan-due-peer-source'));
ok(!report.daily.pendingFollowups.some(item=>['daily-plan-due-outsider-source','daily-plan-due-west-source'].includes(item.id)));
ok(!JSON.stringify(report).includes('OUTSIDE-TEAM-COMPETITOR'));ok(!JSON.stringify(report).includes('OUTSIDE-REGION-COMPETITOR'));
user('manager');report=await get('?date='+reportDay+'&memberId=all');
ok(report.daily.automaticStations.some(stop=>stop.memberId==='outsider'),'Manager scope includes other supervisors and their representatives');
ok(report.daily.pendingFollowups.some(item=>item.id==='daily-plan-due-outsider-source'));ok(!report.daily.automaticStations.some(stop=>stop.memberId==='western'));ok(!report.daily.pendingFollowups.some(item=>item.id==='daily-plan-due-west-source'));
user('owner');report=await get('?date='+reportDay+'&memberId=all');
ok(report.daily.automaticStations.some(stop=>stop.customerId==='daily-location-western'));ok(report.daily.pendingFollowups.some(item=>item.id==='daily-plan-due-west-source'));
eq(dailySnapshot(),beforeDailyRead,'Report reads never create visits, change customer plans, rewrite tracking evidence, or add audit writes');

eq(sql.prepare('PRAGMA foreign_key_check').all(),[]);
console.log(JSON.stringify({ok:true,checks,type:'real SQLite routes and deterministic GPS evidence',coverage:'arrival/exit confirmation, quality/gaps, replay/idempotency, clocks, result timing, self-only writes, hierarchy/current+snapshot regions, transactional revocation, read-only daily enrichment, offline event attribution, explicit products/competitor evidence and due followup scope/cutoff/supersession',realDevice:false}));
