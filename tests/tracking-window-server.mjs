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


const target={latitude:26.437341,longitude:50.034499};
const count=table=>sql.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
const move=at=>{clock=NativeDate.parse(at);};
const mpost=(body,status=200)=>post(body,status,mobile);
const mget=async()=>{const reply=await mobile.GET();eq(reply.status,200);return reply.json();};
const device=crypto.randomUUID();
const begin=(extra={})=>({action:'begin',deviceId:device,createKey:crypto.randomUUID(),continuous:true,...extra});
const sample=(id,capturedAt,stopId=null,meters=0)=>({id,capturedAt,...target,latitude:target.latitude+meters/111194.9266,accuracy:10,stopId});
const samples=(day,points)=>({action:'samples',dayId:day.id,deviceId:device,points});
const select=()=>({action:'select',customerId:'factory',createKey:crypto.randomUUID()});

// Friday is excluded in Saudi time, independent of the device/server timezone.
const windowPolicy=await import(path.join(out,'lib/tracking-window.mjs'));
for(const [at,open,next] of [
 ['2026-10-01T14:59:59.999Z',true,'2026-10-03T03:00:00.000Z'],
 ['2026-10-01T15:00:00.000Z',false,'2026-10-03T03:00:00.000Z'],
 ['2026-10-01T20:59:59.999Z',false,'2026-10-03T03:00:00.000Z'],
 ['2026-10-02T00:00:00+03:00',false,'2026-10-03T03:00:00.000Z'],
 ['2026-10-02T06:00:00+03:00',false,'2026-10-03T03:00:00.000Z'],
 ['2026-10-02T18:00:00+03:00',false,'2026-10-03T03:00:00.000Z'],
 ['2026-10-02T23:59:59.999+03:00',false,'2026-10-03T03:00:00.000Z'],
 ['2026-10-03T00:00:00+03:00',false,'2026-10-03T03:00:00.000Z'],
 ['2026-10-03T05:59:59.999+03:00',false,'2026-10-03T03:00:00.000Z'],
 ['2026-10-03T06:00:00+03:00',true,'2026-10-04T03:00:00.000Z'],
 ['2026-10-03T18:00:00+03:00',false,'2026-10-04T03:00:00.000Z']
]){eq(windowPolicy.trackingWindowOpen(at),open,at);const status=windowPolicy.trackingWindowStatus(at);eq(status.open,open);eq(status.nextStartsAt,next);eq(status.nextBoundaryAt,open?status.endsAt:next);}
eq(windowPolicy.trackingWindowStatus('2026-10-01T21:00:00.000Z').date,'2026-10-02','UTC Thursday evening is Saudi Friday');
eq(windowPolicy.trackingWindowStatus('2026-10-02T21:00:00.000Z').date,'2026-10-03','UTC Friday evening is Saudi Saturday');
eq(windowPolicy.trackingWindowStatus().workingDays,[0,1,2,3,4,6]);
eq(windowPolicy.trackingWindowOpen('invalid'),false);

// Server clock and capture clock both use the fixed company timezone boundaries.
move('2026-10-01T02:59:59.999Z');
let idle=await mpost(begin());eq(idle.day,null);eq(idle.trackingWindow.open,false);eq(idle.trackingWindow.nextStartsAt,'2026-10-01T03:00:00.000Z');
eq(count('crm_mobile_route_days'),0);eq((await post(select())).stop,null);eq(count('crm_journey_stops'),0);
await post({...select(),customerId:'west'},403);
await mpost(begin({createKey:'bad'}),400);
const legacyStart={date:'2026-10-01',startedAt:'2026-09-30T21:00:00.000Z',regionScope:'eastern'};
eq((await mpost(begin(legacyStart))).day,null,'Legacy midnight begin remains enabled without off-hours interval');
eq((await mpost(begin({date:'2026-10-01',regionScope:'eastern'}))).day,null,'A default offline floor before 06:00 pauses without a 400');
move('2026-10-01T03:00:00.000Z');
const legacyBegin=begin(legacyStart),day=(await mpost(legacyBegin)).day;
eq(day.startedAt,'2026-10-01T03:00:00.000Z');eq(day.expiresAt,'2026-10-01T15:00:00.000Z');eq(day.trackingWindow,'06-18');
eq((await mpost(legacyBegin)).day.id,day.id);
let result=await mpost(samples(day,[sample('before-six','2026-10-01T02:59:59.999Z'),sample('at-six','2026-10-01T03:00:00.000Z')]));
eq(result.acknowledgedIds,['before-six','at-six']);eq(result.ignoredIds,['before-six']);eq(count('crm_mobile_route_points'),1);eq(result.day.lastPointAt,'2026-10-01T03:00:00.000Z');
const retainedVersion=result.day.version;
result=await mpost(samples(day,[sample('before-six','2026-10-01T02:59:59.999Z')]));eq(result.day.version,retainedVersion);eq(result.ignoredIds,['before-six']);
await mpost(samples(day,[sample('future','2026-10-01T03:00:06.000Z')]),400);
user('peer');await mpost(samples(day,[sample('hidden-offhours','2026-10-01T02:59:59.999Z')]),404);user('rep');
await mpost({...samples(day,[sample('wrong-device','2026-10-01T02:59:59.999Z')]),deviceId:crypto.randomUUID()},409);
await mpost(samples(day,[sample('foreign-stop','2026-10-01T02:59:59.999Z','missing')]),404);

// An arrival before 18:00 is observed; the scheduled cutoff never fabricates exit.
move('2026-10-01T14:54:00.000Z');const stop=(await post(select())).stop;
const timedPoints=Array.from({length:6},(_,i)=>sample('near-end-'+i,new Date(NativeDate.parse('2026-10-01T14:54:15.000Z')+i*60000).toISOString(),stop.id));
move('2026-10-01T15:00:00.000Z');
result=await mpost(samples(day,[...timedPoints,sample('at-eighteen','2026-10-01T15:00:00.000Z',stop.id)]));
eq(result.ignoredIds,['at-eighteen']);eq(result.activeStop,null);eq(result.day.endedAt,'2026-10-01T15:00:00.000Z');eq(count('crm_mobile_route_points'),7);
let projected=(await get('?stopId='+stop.id)).stop;
eq(projected.state,'interrupted');eq(projected.closedAt,'2026-10-01T15:00:00.000Z');eq(projected.data.arrivalAt,'2026-10-01T14:54:15.000Z');eq(projected.data.departureAt,null);eq(projected.data.durationSeconds,null);eq(projected.data.events.at(-1).reason,'tracking_window_ended');
const persistedStop=sql.prepare('SELECT data FROM crm_journey_stops WHERE id=?').get(stop.id).data;
const beforeOffhours=count('crm_mobile_route_points');
move('2026-10-01T16:00:00.000Z');result=await mpost(samples(day,[sample('at-nineteen','2026-10-01T16:00:00.000Z',stop.id)]));eq(result.ignoredIds,['at-nineteen']);eq(count('crm_mobile_route_points'),beforeOffhours);eq(sql.prepare('SELECT data FROM crm_journey_stops WHERE id=?').get(stop.id).data,persistedStop);
eq((await mpost(begin())).day,null);eq((await post(select())).active,null);
await mpost({action:'gap',dayId:day.id,deviceId:device,at:iso(),reason:'gps_unavailable'});eq(sql.prepare('SELECT data FROM crm_journey_stops WHERE id=?').get(stop.id).data,persistedStop,'Scheduled pause is not a new GPS failure gap');
await post({action:'gap',stopId:stop.id,reason:'gps_unavailable'});eq(sql.prepare('SELECT data FROM crm_journey_stops WHERE id=?').get(stop.id).data,persistedStop);

// Reporting ends observations at their final sample, rather than adding overnight time.
user('supervisor');let report=await get('?date=2026-10-01&memberId=rep');
eq(report.mobileDays[0].endedAt,'2026-10-01T15:00:00.000Z');eq(report.mobileDays[0].automaticStops.length,1);eq(report.mobileDays[0].automaticStops[0].observedDurationSeconds,300);eq(report.mobileDays[0].automaticStops[0].departureDetectedAt,null);eq(report.mobileDays[0].automaticStops[0].status,'interrupted');ok(!report.mobileDays[0].gaps.some(gap=>gap.to>'2026-10-01T15:00:00.000Z'));
user('other-supervisor');await get('?date=2026-10-01&memberId=rep',403);user('rep');

// Explicit CRM visit operations remain available outside route collection hours.
const visitBody={createKey:crypto.randomUUID(),customerId:'factory',customerVersion:rawRecord('factory').version,timingMode:'automatic',elapsedMilliseconds:2700000,data:{type:'visit',date:'2026-10-01',summary:'تعريف بمنتجات الشركة',result:'متابعة العميل',salesStage:'new',strength:'strong',nextAction:'متابعة المواصفات',nextDate:'2026-10-02',requestedProducts:['قوالب البلوك المتحركة'],location:target.latitude+', '+target.longitude,locationSource:'device',locationCapturedAt:iso(),locationAccuracy:10,journeyStopId:stop.id}};
const saved=await post(visitBody,200,visits);eq(record(saved.id).data.result,'متابعة العميل');eq(count('crm_mobile_route_points'),beforeOffhours);eq(record(saved.id).data.endedAt,'');eq(record(saved.id).data.durationSeconds,null);

// Same-day in-window offline queues can create a closed eligible interval after18.
member('same-day-offline','rep','supervisor');sql.prepare('UPDATE crm_members SET created_at=? WHERE id=?').run('2026-09-30T03:00:00.000Z','same-day-offline');user('same-day-offline');
const queued=(await mpost(begin({date:'2026-10-01',startedAt:'2026-10-01T03:00:00.000Z',regionScope:'eastern'}))).day;
eq(queued.endedAt,'2026-10-01T15:00:00.000Z');
result=await mpost(samples(queued,[sample('offline-daytime','2026-10-01T14:59:58.999Z'),sample('offline-after','2026-10-01T15:00:00.000Z')]));eq(result.acknowledgedIds,['offline-daytime','offline-after']);eq(result.ignoredIds,['offline-after']);eq(result.day.lastPointAt,'2026-10-01T14:59:58.999Z');
await mpost(samples(queued,[sample('wrong-capture-day','2026-09-30T16:00:00.000Z')]),400);
sql.prepare("UPDATE crm_members SET region_scope='western' WHERE id='same-day-offline'").run();await mpost(samples(queued,[sample('scope-offhours','2026-10-01T16:00:00.000Z')]),403);
sql.prepare("UPDATE crm_members SET region_scope='eastern' WHERE id='same-day-offline'").run();
move('2026-10-03T16:00:00.001Z');result=await mpost(samples(queued,[sample('delayed-offhours','2026-10-01T16:00:00.000Z')]));eq(result.ignoredIds,['delayed-offhours'],'Delayed off-hours samples stay excluded');
result=await mpost(samples(queued,[sample('offline-daytime','2026-10-01T14:59:58.999Z')]));eq(result.acknowledgedIds,['offline-daytime'],'An exact previously saved retry remains idempotent beyond the fresh-upload age');
result=await mpost(samples(queued,[sample('delayed-daytime','2026-10-01T14:59:59.998Z')]));eq(result.acknowledgedIds,['delayed-daytime'],'Eligible delayed evidence is retained even after48 hours');

// Friday upload is allowed for eligible Thursday captures, but Friday creates no
// interval/station and never stores newly received Friday location observations.
move('2026-10-01T12:00:00.000Z');member('friday-policy','rep','supervisor');user('friday-policy');
const thursdayDay=(await mpost(begin())).day,thursdayStop=(await post(select())).stop;
move('2026-10-02T09:00:00.000Z');
result=await mpost(samples(thursdayDay,[sample('thursday-queued','2026-10-01T12:01:00.000Z',thursdayStop.id)]));
eq(result.ignoredIds,[]);eq(result.day.lastPointAt,'2026-10-01T12:01:00.000Z');eq(result.trackingWindow.open,false);eq(result.trackingWindow.nextStartsAt,'2026-10-03T03:00:00.000Z');
const fridayCounts=[count('crm_mobile_route_days'),count('crm_journey_stops')];
for(const at of ['2026-10-01T21:00:00.000Z','2026-10-02T03:00:00.000Z','2026-10-02T15:00:00.000Z','2026-10-02T20:59:59.999Z']){move(at);eq((await mpost(begin())).day,null);eq((await mpost(begin({date:'2026-10-02',startedAt:at,regionScope:'eastern'}))).day,null);eq((await post(select())).stop,null);eq([count('crm_mobile_route_days'),count('crm_journey_stops')],fridayCounts);}
move('2026-10-02T09:00:00.000Z');
const fridayVisit=await post({...visitBody,createKey:crypto.randomUUID(),customerVersion:rawRecord('factory').version,data:{...visitBody.data,date:'2026-10-02',journeyStopId:undefined,locationCapturedAt:iso(),nextDate:'2026-10-03'}},200,visits);
eq(record(fridayVisit.id).data.date,'2026-10-02','Explicit visits still save on Friday');
const fridayFollowup=await post({createKey:crypto.randomUUID(),customerId:'factory',customerVersion:rawRecord('factory').version,sourceId:fridayVisit.id,sourceVersion:record(fridayVisit.id).version,data:{type:'call',date:'2026-10-02',result:'تم تنفيذ المتابعة',salesStage:'specs',invoiceOutcome:'pending',nextAction:'متابعة العرض',nextDate:'2026-10-03'}},200,followups);
eq(record(fridayFollowup.id).data.sourceId,fridayVisit.id,'Friday follow-up remains linked to its visit');
// A pre-update Friday row and its evidence remain intact and reportable. New
// points from an old installed APK are acknowledged and discarded, not persisted.
sql.prepare('UPDATE crm_journey_stops SET closed_at=?,state=? WHERE id=?').run('2026-10-01T15:00:00.000Z','interrupted',thursdayStop.id);
sql.prepare('UPDATE crm_mobile_route_days SET ended_at=? WHERE id=?').run('2026-10-01T15:00:00.000Z',thursdayDay.id);
const fridayLegacy={id:'friday-legacy-stop',memberId:'friday-policy',date:'2026-10-02',customerId:'factory',regionScope:'eastern',snapshot:{customerName:'Factory',region:'الشرقية',...target},selectedAt:'2026-10-02T03:00:00.000Z',closedAt:null,state:'en_route',data:engine.initialJourneyData('2026-10-02T03:00:00.000Z'),version:1};
sql.prepare('INSERT INTO crm_journey_stops(id,member_id,date,customer_id,region_scope,snapshot,selected_at,closed_at,state,data,version) VALUES(?,?,?,?,?,?,?,?,?,?,1)').run(fridayLegacy.id,fridayLegacy.memberId,fridayLegacy.date,fridayLegacy.customerId,fridayLegacy.regionScope,JSON.stringify(fridayLegacy.snapshot),fridayLegacy.selectedAt,null,fridayLegacy.state,JSON.stringify(fridayLegacy.data));
sql.prepare('INSERT INTO crm_mobile_route_days(id,member_id,device_id,date,region_scope,started_at,ended_at,data,version) VALUES(?,?,?,?,?,?,NULL,?,1)').run('friday-legacy-day','friday-policy',device,'2026-10-02','eastern',fridayLegacy.selectedAt,JSON.stringify({gaps:[]}));
const historicPoint=sample('existing-friday','2026-10-02T03:01:00.000Z',fridayLegacy.id);
sql.prepare('INSERT INTO crm_mobile_route_points(day_id,point_id,captured_at,received_at,latitude,longitude,accuracy,stop_id) VALUES(?,?,?,?,?,?,?,?)').run('friday-legacy-day',historicPoint.id,historicPoint.capturedAt,historicPoint.capturedAt,historicPoint.latitude,historicPoint.longitude,historicPoint.accuracy,historicPoint.stopId);
const oldFridayDay={id:'friday-legacy-day'},snapshotFriday=sql.prepare('SELECT * FROM crm_mobile_route_days WHERE id=?').get(oldFridayDay.id),snapshotFridayStop=sql.prepare('SELECT * FROM crm_journey_stops WHERE id=?').get(fridayLegacy.id);
result=await mpost(samples(oldFridayDay,[historicPoint,sample('new-friday','2026-10-02T08:59:59.000Z',fridayLegacy.id)]));eq(result.acknowledgedIds,['existing-friday','new-friday']);eq(result.ignoredIds,['new-friday']);
const {stopId:ignoredStop,...browserFridayPoint}=sample('browser-friday','2026-10-02T08:59:58.000Z');
result=await post({action:'samples',stopId:fridayLegacy.id,points:[browserFridayPoint]});eq(result.ignoredIds,['browser-friday']);
eq(sql.prepare('SELECT COUNT(*) n FROM crm_mobile_route_points WHERE day_id=?').get(oldFridayDay.id).n,1);eq(sql.prepare('SELECT COUNT(*) n FROM crm_journey_points WHERE stop_id=?').get(fridayLegacy.id).n,0);
await mpost({action:'gap',dayId:oldFridayDay.id,deviceId:device,at:iso(),reason:'gps_unavailable'});await post({action:'gap',stopId:fridayLegacy.id,reason:'gps_unavailable'});
eq(sql.prepare('SELECT * FROM crm_mobile_route_days WHERE id=?').get(oldFridayDay.id),snapshotFriday);eq(sql.prepare('SELECT * FROM crm_journey_stops WHERE id=?').get(fridayLegacy.id),snapshotFridayStop);
user('supervisor');const fridayReport=await get('?date=2026-10-02&memberId=friday-policy');eq(fridayReport.mobileDays[0].points[0].id,'existing-friday');eq(fridayReport.mobileDays[0].gaps,[]);eq(fridayReport.stops[0].id,fridayLegacy.id);user('friday-policy');
move('2026-10-03T03:00:00.000Z');const saturday=(await mpost(begin())).day;eq(saturday.date,'2026-10-03');eq(saturday.startedAt,'2026-10-03T03:00:00.000Z');result=await mpost(samples(saturday,[sample('saturday-six','2026-10-03T03:00:00.000Z')]));eq(result.ignoredIds,[]);eq(result.day.lastPointAt,'2026-10-03T03:00:00.000Z');ok((await post(select())).stop);

// A previous unfinished visit pauses at18; later captured daytime evidence may
// refine it, while no current-day stop is reassigned or reopened by the queue.
member('late-window','rep','supervisor');user('late-window');move('2026-10-04T14:58:00.000Z');
const oldDay=(await mpost(begin())).day,oldStop=(await post(select())).stop;
move('2026-10-04T14:58:15.000Z');await mpost(samples(oldDay,[sample('first','2026-10-04T14:58:15.000Z',oldStop.id)]));
move('2026-10-05T03:00:00.000Z');const today=(await mpost(begin())).day;
eq(sql.prepare('SELECT closed_at FROM crm_journey_stops WHERE id=?').get(oldStop.id).closed_at,'2026-10-04T15:00:00.000Z');
result=await mpost(samples(oldDay,[sample('confirm-arrival','2026-10-04T14:58:30.000Z',oldStop.id),sample('exit-candidate','2026-10-04T14:58:45.000Z',oldStop.id,300),sample('exit-confirmed','2026-10-04T14:59:00.000Z',oldStop.id,300)]));
const proven=JSON.parse(sql.prepare('SELECT data FROM crm_journey_stops WHERE id=?').get(oldStop.id).data);eq(proven.arrivalAt,'2026-10-04T14:58:15.000Z');eq(proven.departureAt,'2026-10-04T14:58:45.000Z');eq(proven.durationSeconds,30);eq((await mget()).day.id,today.id);
const snapshot=sql.prepare('SELECT * FROM crm_journey_stops WHERE id=?').get(oldStop.id);await mpost(samples(oldDay,[sample('confirm-arrival','2026-10-04T14:58:30.000Z',oldStop.id)]));eq(sql.prepare('SELECT * FROM crm_journey_stops WHERE id=?').get(oldStop.id),snapshot);

// Already stored pre-update historical data stays intact, including off-hours
// observations. Current legacy records pause without constructing inverted gaps.
member('legacy','rep','supervisor');user('legacy');move('2026-10-06T02:00:00.000Z');
const legacyStop={id:'legacy-stop',memberId:'legacy',date:'2026-10-06',customerId:'factory',regionScope:'eastern',snapshot:{customerName:'Factory',region:'الشرقية',...target},selectedAt:'2026-10-05T21:30:00.000Z',closedAt:null,state:'en_route',data:engine.initialJourneyData('2026-10-05T21:30:00.000Z'),version:1};
sql.prepare('INSERT INTO crm_journey_stops(id,member_id,date,customer_id,region_scope,snapshot,selected_at,closed_at,state,data,version) VALUES(?,?,?,?,?,?,?,?,?,?,1)').run(legacyStop.id,legacyStop.memberId,legacyStop.date,legacyStop.customerId,legacyStop.regionScope,JSON.stringify(legacyStop.snapshot),legacyStop.selectedAt,null,legacyStop.state,JSON.stringify(legacyStop.data));
sql.prepare('INSERT INTO crm_mobile_route_days(id,member_id,device_id,date,region_scope,started_at,ended_at,data,version) VALUES(?,?,?,?,?,?,NULL,?,1)').run('legacy-day','legacy',device,'2026-10-06','eastern',legacyStop.selectedAt,JSON.stringify({gaps:[]}));
eq((await get()).active.data.gaps,[],'Before06 legacy open stop shows a scheduled pause, without no_recent_location failure');
user('supervisor');report=await get('?date=2026-10-06&memberId=legacy');eq(report.mobileDays[0].gaps,[]);user('legacy');
const lastLegacy=sample('legacy-afterhours','2026-10-06T16:00:00.000Z',legacyStop.id);legacyStop.data.lastPoint=lastLegacy;
sql.prepare('UPDATE crm_journey_stops SET data=? WHERE id=?').run(JSON.stringify(legacyStop.data),legacyStop.id);
move('2026-10-06T17:00:00.000Z');projected=(await get()).stop;eq(projected.state,'interrupted');ok(projected.data.gaps.every(gap=>gap.from<=gap.to),'Existing afterhours legacy evidence cannot produce negative gaps');eq(projected.data.departureAt,null);eq(projected.data.durationSeconds,null);
const historicalBefore=sql.prepare('SELECT * FROM crm_journey_stops WHERE id=?').get(legacyStop.id);
move('2026-10-07T09:00:00.000Z');user('supervisor');report=await get('?date=2026-10-06&memberId=legacy');eq(report.stops[0].data.lastPoint.id,'legacy-afterhours');eq(report.mobileDays[0].expiresAt,'2026-10-06T21:00:00.000Z','Unmarked historical day retains its previous report semantics');eq(sql.prepare('SELECT * FROM crm_journey_stops WHERE id=?').get(legacyStop.id),historicalBefore);
eq(sql.prepare('PRAGMA foreign_key_check').all(),[]);
console.log(JSON.stringify({suite:'tracking-window-server',checks,passed:true,window:'06:00-18:00 Asia/Riyadh, except Friday',realDevice:false}));
