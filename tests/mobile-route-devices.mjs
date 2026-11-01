// One representative, two phones: the day belongs to one collector, and another phone takes it over only after the first
// has gone quiet (a reinstalled app, a phone left off). Real route handlers on isolated SQLite; only sign-in is mocked.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'route-devices-')),seen=new Set();
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

void visits;void followups;
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const ok=(actual,message)=>{assert.ok(actual,message);checks++;};
function request(body){return new Request('https://test.invalid/api/mobile-route',{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json'},body:JSON.stringify(body)});}
async function mp(body,status=200){const response=await mobile.POST(request(body));const payload=await response.json();eq(response.status,status,JSON.stringify(payload));return payload;}
async function mg(){const response=await mobile.GET();eq(response.status,200);return response.json();}
const target={latitude:26.437341,longitude:50.034499};
const minutes=n=>n*60_000;
const point=(id,capturedAt,meters=0)=>({id,capturedAt,latitude:target.latitude+meters/111194.9266,longitude:target.longitude,accuracy:10,stopId:null});
const phoneA=crypto.randomUUID(),phoneB=crypto.randomUUID(),phoneC=crypto.randomUUID();
const begin=(device,key=crypto.randomUUID())=>({action:'begin',deviceId:device,createKey:key,continuous:true,regionScope:'eastern',date:'2026-09-30',startedAt:iso()});
const row=id=>sql.prepare('SELECT * FROM crm_mobile_route_days WHERE id=?').get(id);
sql.prepare("UPDATE crm_members SET created_at='2026-09-01T00:00:00.000Z' WHERE id='rep'").run();

// 12:00 Riyadh. The first phone starts the day and sends samples.
let dayA=(await mp(begin(phoneA))).day;eq(dayA.deviceId,phoneA);
await mp({action:'samples',dayId:dayA.id,deviceId:phoneA,points:[point('a1',iso())]});
eq((await mg()).day?.id,dayA.id,'A heard collector holds the day');

// While the first phone is heard, a second phone is refused, before and right up to the silence limit.
let refused=await mp(begin(phoneB),409);ok(/جهاز آخر/.test(refused.error),'The refusal names the other device');
advance(minutes(29));refused=await mp(begin(phoneB),409);eq((await mg()).day?.id,dayA.id);
// An interruption the first phone records keeps it heard.
const gapA=await mp({action:'gap',dayId:dayA.id,deviceId:phoneA,stopId:null,at:iso(),reason:'gps_unavailable'});ok(gapA.day.gaps.length>0);
advance(minutes(29));await mp(begin(phoneB),409);eq((await mg()).day?.id,dayA.id,'A recorded gap keeps the collector heard');
// A long offline backlog is alive: the samples are old, but they arrive now.
advance(minutes(40));
const backlog=await mp({action:'samples',dayId:dayA.id,deviceId:phoneA,points:[point('a2',new Date(Date.parse(iso())-minutes(39)).toISOString(),20)]});ok(backlog.acknowledgedIds.includes('a2'));
ok(Date.now()-Date.parse(backlog.day.lastPointAt)>=minutes(30),'The newest captured sample is old');
await mp(begin(phoneB),409);eq((await mg()).day?.id,dayA.id,'A sample received now keeps the collector heard');

// The first phone goes quiet (the app was removed). After half an hour the day is no longer reported to any phone...
advance(minutes(31));
const quiet=await mg();eq(quiet.day,null,'A quiet day is not reported, so a new app can enroll');ok(quiet.memberId==='rep'&&quiet.serverTime,'The rest of the answer is unchanged');
const beforeA=row(dayA.id);const heardA=[beforeA.started_at,beforeA.last_point_at,...JSON.parse(beforeA.data).gaps.map(g=>g.to)].sort().at(-1);
// ...and the new phone takes it over: the quiet day closes where it was last heard, the new day starts now.
const keyB=crypto.randomUUID(),takeover=await mp(begin(phoneB,keyB));const dayB=takeover.day;
eq(dayB.deviceId,phoneB);eq(row(dayA.id).ended_at,heardA,'The quiet day closes at the last moment it was heard');ok(dayB.startedAt>=heardA&&dayB.startedAt<=iso(),'The new day starts after the old one ends');
eq((await mp(begin(phoneB,keyB))).day.id,dayB.id,'The takeover is idempotent');
eq(sql.prepare("SELECT COUNT(*) AS n FROM crm_mobile_route_days WHERE member_id='rep' AND ended_at IS NULL").get().n,1,'Still one open day');
eq((await mg()).day?.id,dayB.id,'The new phone now holds the day');
await mp({action:'samples',dayId:dayB.id,deviceId:phoneB,points:[point('b1',iso())]});

// The first phone, if it comes back, is told the day moved (409, so the app checks and stops) instead of retrying for ever.
const moved=await mp({action:'samples',dayId:dayA.id,deviceId:phoneA,points:[point('a3',iso())]},409);ok(/جهاز آخر/.test(moved.error));
await mp({action:'gap',dayId:dayA.id,deviceId:phoneA,stopId:null,at:iso(),reason:'gps_unavailable'},409);
// Its own saved begin still answers with its own (closed) day, and a fresh begin is refused while the new phone is heard.
eq((await mp(begin(phoneA,dayA.id.replace('mobile-rep-','')))).day.id,dayA.id);ok((await mp(begin(phoneA,dayA.id.replace('mobile-rep-','')))).day.endedAt);
await mp(begin(phoneA),409);
// A third phone is refused too: the new phone is heard.
await mp(begin(phoneC),409);

// The supervisor's report shows both parts of the day, without device identifiers.
user('supervisor');
const report=await (await journeys.GET(new Request('https://test.invalid/api/journeys?date=2026-09-30&memberId=rep'))).json();
eq(report.mobileDays.map(d=>d.id),[dayA.id,dayB.id]);eq(report.mobileDays.map(d=>d.deviceId),[undefined,undefined]);
user('rep');

// Another representative's quiet day is never theirs to take: days are per member.
member('rep2','rep','supervisor');user('rep2');const other=(await mp(begin(phoneC))).day;eq(other.memberId,'rep2');user('rep');
eq(row(dayB.id).ended_at,null,'Another member starting does not touch this day');

// A historical (offline) begin for an earlier day never takes over today's day.
advance(minutes(31));
await mp({action:'begin',deviceId:phoneC,createKey:crypto.randomUUID(),continuous:true,regionScope:'eastern',date:'2026-09-29',startedAt:'2026-09-29T05:00:00.000Z'});
eq(row(dayB.id).ended_at,null,'A late offline day leaves today alone');

// After 18:00 nothing is recorded: a quiet open day is not reported, and a begin outside the window creates nothing.
clock=NativeDate.parse('2026-09-30T15:40:00.000Z');
eq((await mg()).day,null);const evening=await mp({action:'begin',deviceId:phoneC,createKey:crypto.randomUUID(),continuous:true},200);eq(evening.day,null);eq(row(dayB.id).ended_at,null);

// Supervisors and managers (the manual tracker) are answered exactly as before: their quiet day is still reported to them,
// and another of their devices is still refused, quiet or not.
clock=NativeDate.parse('2026-09-30T10:00:00.000Z');user('supervisor');
const manual=(await mp({action:'begin',deviceId:phoneA,createKey:crypto.randomUUID()})).day;eq(manual.memberId,'supervisor');
advance(minutes(45));eq((await mg()).day?.id,manual.id,'A supervisor still sees a quiet day');
await mp({action:'begin',deviceId:phoneB,createKey:crypto.randomUUID()},409);eq(row(manual.id).ended_at,null,'No takeover outside continuous representative tracking');
user('rep');
eq(sql.prepare('PRAGMA foreign_key_check').all(),[]);
console.log(JSON.stringify({suite:'mobile-route-devices',checks,passed:true}));
