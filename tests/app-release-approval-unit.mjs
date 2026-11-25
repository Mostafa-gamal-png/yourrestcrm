// «اعتماد التحديث للجميع» (lib/app-release-approval.ts, 2026-11-25, item 2 of «اعمل التلاتة»): a new Android release is a pilot until the
// owner tries it on a real phone and approves it. On the real modules (transpiled as the build does) with made-up releases only:
// 1. What is published, served and offered: the base and the valid pilots newer than it, the newest approved one served, never a lower one,
//    a broken pilot never served or offered.
// 2. The approval row (node:sqlite over the real migrations): parsed strictly, written once per newer version, never moved back, refused
//    when the row changed since it was read (two approvals at once).
// 3. The two routes over stand-ins of the session: /api/app-update serves the base until an approval and the base when the database cannot
//    be read; /api/app-update/pilot is for the owner's account kind only (an administrator over every region), and answers the pilot,
//    the approval and the refusals (unknown 404, older or changed 409, a bad number 400).
// 4. scripts/publish-android-release.mjs publishes a new build as a pilot (the base files untouched) unless --base, and
//    scripts/promote-android-pilot.mjs makes an approved pilot the base, both in a folder of their own.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createLoader,makeChecks} from '../scripts/lib/load-ts.mjs';

const root=process.cwd();
const {eq,ok,report}=makeChecks(assert);
const BASE=JSON.parse(fs.readFileSync(path.join(root,'lib/app-update-release.json'),'utf8'));
const CERT='1d49b33c2c3039c1c7f3849d91a7890e81616211df9a4958dc470584acc1ff50';
const manifest=(name,code,over={})=>({schemaVersion:1,packageName:'org.yourrest.crm',versionName:name,versionCode:code,minimumVersionCode:code,apkUrl:`https://crm.yourrest.org/downloads/yourrest-crm-android-v${name}-${code}.apk`,sizeBytes:1000+code,sha256:'c'.repeat(64),certificateSha256:CERT,releaseNotes:{ar:['تحسينات '+name],en:['Improvements '+name]},publishedAt:'2026-11-25T08:00:00.000Z',...over});
const next=(step)=>{const parts=BASE.versionName.split('.').map(Number);parts[2]+=step;return [parts.join('.'),BASE.versionCode+step];};
const [n1,c1]=next(1),[n2,c2]=next(2),[n3,c3]=next(3);
const P1=manifest(n1,c1),P2=manifest(n2,c2),P3=manifest(n3,c3);

// ---- 1. published, served, offered
const {load}=createLoader('app-release-approval');
const A=await load('lib/app-release-approval.ts');
eq(A.APP_RELEASE_APPROVAL,'android-release-approval','the settings row');
const published=A.publishedReleases(BASE,[P2,manifest('0.0.1',1),{broken:true},P1,manifest(n3,c3,{apkUrl:'https://evil.example/x.apk'}),'x',null,manifest(BASE.versionName,BASE.versionCode)]);
eq(published.base.versionCode,BASE.versionCode,'the base');
eq(published.pilots.map(item=>item.versionCode),[c1,c2],'only valid pilots newer than the base, oldest first (an older, a broken, a foreign host and the base itself left out)');
eq(A.publishedReleases(BASE,'not a list').pilots,[],'a pilots file that is not a list offers nothing');
eq(A.publishedReleases().pilots.map(item=>item.versionCode),JSON.parse(fs.readFileSync(path.join(root,'lib/app-update-pilots.json'),'utf8')).map(item=>item.versionCode).filter(code=>code>BASE.versionCode),'the shipped pilots file');
const three={base:BASE,pilots:[P1,P2,P3]};
eq(A.servedRelease(null,three).versionCode,BASE.versionCode,'nothing approved: the base is served');
eq(A.servedRelease(BASE.versionCode,three).versionCode,BASE.versionCode,'the base approved: the base');
eq(A.servedRelease(c1,three).versionCode,c1,'the first pilot approved: it is served');
eq(A.servedRelease(c2,three).versionCode,c2,'the second approved: the second (and the first with it)');
eq(A.servedRelease(c3+50,three).versionCode,c3,'an approval of a version not published here serves the newest published at or below it');
eq(A.servedRelease(BASE.versionCode-5,three).versionCode,BASE.versionCode,'an approval older than the base never lowers what is served');
eq(A.servedRelease(c2,{base:BASE,pilots:[]}).versionCode,BASE.versionCode,'a pilot that left the file is not served');
eq(A.pendingPilot(null,three)?.versionCode,c3,'nothing approved: the newest pilot is offered');
eq(A.pendingPilot(c1,three)?.versionCode,c3,'one approved: the newest not yet approved');
eq(A.pendingPilot(c3,three),null,'the newest approved: nothing to try');
eq(A.pendingPilot(null,{base:BASE,pilots:[]}),null,'no pilot: nothing');
eq(A.pilotView(null),null,'no pilot: no view');
eq(A.pilotView(P1),{versionName:n1,versionCode:c1,apkPath:`/downloads/yourrest-crm-android-v${n1}-${c1}.apk`,sizeBytes:P1.sizeBytes,notes:{ar:['تحسينات '+n1],en:['Improvements '+n1]}},'the view: what is needed to try it, the path on this site');

// ---- 2. the approval row
const good={versionCode:c1,approvedBy:'owner',approvedAt:'2026-11-25T09:00:00.000Z'};
eq(A.parseApproval(JSON.stringify(good)),good,'an approval');
for(const bad of [null,undefined,'','{','[]','null','5',JSON.stringify({...good,versionCode:0}),JSON.stringify({...good,versionCode:-1}),JSON.stringify({...good,versionCode:1.5}),JSON.stringify({...good,versionCode:String(c1)}),JSON.stringify({...good,approvedBy:5}),JSON.stringify({...good,approvedAt:'yesterday'}),JSON.stringify({versionCode:c1})])eq(A.parseApproval(bad),null,'not an approval: '+String(bad).slice(0,40));
eq(A.parseApproval(JSON.stringify({...good,extra:'x'})),good,'an extra field is dropped');
const sql=new DatabaseSync(':memory:');
for(const file of fs.readdirSync(path.join(root,'drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).sort())sql.exec(fs.readFileSync(path.join(root,'drizzle',file),'utf8').replaceAll('--> statement-breakpoint',''));
class Statement{
 constructor(query,args=[]){this.query=query;this.args=args;}
 bind(...args){return new Statement(this.query,args);}
 async run(){const result=sql.prepare(this.query).run(...this.args);return {success:true,meta:{changes:Number(result.changes)}};}
 async first(){if(db.beforeFirst)await db.beforeFirst(this.query);const row=sql.prepare(this.query).get(...this.args);return row?{...row}:null;}
}
const db={prepare:query=>new Statement(query)};
const row=()=>sql.prepare('SELECT owner_id FROM crm_settings WHERE id=?').get('android-release-approval')?.owner_id??null;
eq(await A.readReleaseApproval(db),null,'no row: nothing approved');
eq(await A.approveRelease(db,c3+1,'owner','2026-11-25T09:00:00.000Z',three),'unknown','a version that is not a pilot here is refused');
eq(await A.approveRelease(db,BASE.versionCode,'owner','2026-11-25T09:00:00.000Z',three),'unknown','the base is not approved: it already is');
eq(row(),null,'and nothing is written');
eq(await A.approveRelease(db,c1,'owner','2026-11-25T09:00:00.000Z',three),'approved','the first pilot approved');
eq(await A.readReleaseApproval(db),{versionCode:c1,approvedBy:'owner',approvedAt:'2026-11-25T09:00:00.000Z'},'kept with who and when');
eq(await A.approveRelease(db,c1,'owner','2026-11-25T09:05:00.000Z',three),'older','approving it again is refused');
eq(await A.approveRelease(db,c2,'owner','2026-11-25T10:00:00.000Z',three),'approved','a newer pilot approved over it');
eq(await A.approveRelease(db,c1,'owner','2026-11-25T10:05:00.000Z',three),'older','an approval never moves back');
eq(JSON.parse(row()).versionCode,c2,'the row keeps the newer one');
// Two approvals at once: the row changes between the read and the write, so the second writes nothing.
db.beforeFirst=async()=>{db.beforeFirst=null;sql.prepare('UPDATE crm_settings SET owner_id=? WHERE id=?').run(JSON.stringify({versionCode:c2,approvedBy:'other',approvedAt:'2026-11-25T10:59:00.000Z'}),'android-release-approval');};
// (the read happens after the change here, so this one sees `other` and approves over it; the race is the next one)
eq(await A.approveRelease(db,c3,'owner','2026-11-25T11:00:00.000Z',three),'approved','a newer approval after another one was saved');
sql.prepare('UPDATE crm_settings SET owner_id=? WHERE id=?').run(JSON.stringify({versionCode:c2,approvedBy:'owner',approvedAt:'2026-11-25T10:00:00.000Z'}),'android-release-approval');
const realFirst=Statement.prototype.first;
Statement.prototype.first=async function(){const result=await realFirst.call(this);sql.prepare('UPDATE crm_settings SET owner_id=? WHERE id=?').run(JSON.stringify({versionCode:c3,approvedBy:'other',approvedAt:'2026-11-25T11:30:00.000Z'}),'android-release-approval');return result;};
eq(await A.approveRelease(db,c3,'owner','2026-11-25T11:31:00.000Z',three),'changed','the row changed after it was read: nothing written');
Statement.prototype.first=realFirst;
eq(JSON.parse(row()).approvedBy,'other','the other approval stands');
sql.prepare('DELETE FROM crm_settings WHERE id=?').run('android-release-approval');
Statement.prototype.first=async function(){const result=await realFirst.call(this);if(/SELECT owner_id/.test(this.query))sql.prepare('INSERT INTO crm_settings(id,owner_id) VALUES(?,?)').run('android-release-approval',JSON.stringify({versionCode:c1,approvedBy:'other',approvedAt:'2026-11-25T12:00:00.000Z'}));return result;};
eq(await A.approveRelease(db,c2,'owner','2026-11-25T12:01:00.000Z',three),'changed','the first approval written by someone else meanwhile: nothing written');
Statement.prototype.first=realFirst;
eq(JSON.parse(row()).versionCode,c1,'the other first approval stands');
sql.prepare('UPDATE crm_settings SET owner_id=? WHERE id=?').run('{broken','android-release-approval');
eq(await A.readReleaseApproval(db),null,'a row that cannot be read approves nothing');
eq(await A.approveRelease(db,c1,'owner','2026-11-25T12:10:00.000Z',three),'approved','and a new approval replaces it');

// ---- 3. the routes, over stand-ins of the session and the shipped pilots replaced by two made-up ones
class CRMError extends Error{constructor(message,status=400){super(message);this.status=status;}}
const session={me:null,db:null,dbFails:false,origin:true};
globalThis.__releaseTest={session,CRMError};
const crmServer=`const t=globalThis.__releaseTest;
export const CRMError=t.CRMError;
export function database(){if(t.session.dbFails)throw new CRMError('db',503);return t.session.db;}
export async function context(){if(!t.session.me)throw new CRMError('sign in',401);return {me:t.session.me,db:t.session.db};}
export function checkOrigin(){if(!t.session.origin)throw new CRMError('origin',403);}
export async function readJsonBody(req){return JSON.parse(await req.text());}
export function replyError(e){if(e instanceof CRMError)return Response.json({error:e.message},{status:e.status});return Response.json({error:'x'},{status:500});}`;
const routeLoader=createLoader('app-release-routes',{replace:{'@/lib/crm-server':crmServer,'./app-update-pilots.json':'export default '+JSON.stringify([P1,P2])+';'}});
const served=await routeLoader.load('app/api/app-update/route.ts'),pilot=await routeLoader.load('app/api/app-update/pilot/route.ts');
const member=(id,role,regionScope='all',active=1)=>({id,role,regionScope,active,name:id,email:id+'@example.invalid',authVersion:1});
const owner=member('owner','admin'),regionalAdmin=member('admin2','admin','central'),manager=member('mgr','manager'),rep=member('rep','rep','eastern');
sql.prepare('DELETE FROM crm_settings WHERE id=?').run('android-release-approval');
session.db=db;
let response=await served.GET();
eq([response.status,(await response.json()).versionCode,response.headers.get('cache-control')],[200,BASE.versionCode,'no-store, max-age=0'],'/api/app-update: nothing approved, the base, never cached');
session.dbFails=true;response=await served.GET();
eq((await response.json()).versionCode,BASE.versionCode,'a database that cannot be read serves the base, never a pilot');
session.dbFails=false;
const ask=async(method,body,me)=>{session.me=me;const res=method==='GET'?await pilot.GET():await pilot.POST(new Request('https://crm.yourrest.org/api/app-update/pilot',{method:'POST',body:JSON.stringify(body)}));return {status:res.status,body:await res.json(),cache:res.headers.get('cache-control')};};
eq((await ask('GET',null,null)).status,401,'nobody signed in: 401');
for(const who of [regionalAdmin,manager,rep]){eq((await ask('GET',null,who)).status,403,'GET refused to '+who.id);eq((await ask('POST',{action:'approve',versionCode:c1},who)).status,403,'POST refused to '+who.id);}
eq(row(),null,'nothing approved by a refused account');
let answer=await ask('GET',null,owner);
eq([answer.status,answer.body.pilot?.versionCode,answer.body.served,answer.body.approval,answer.cache],[200,c2,{versionName:BASE.versionName,versionCode:BASE.versionCode},null,'no-store'],'the owner: the newest pilot to try, the base served, nothing approved');
eq(Object.keys(answer.body.pilot).sort(),['apkPath','notes','sizeBytes','versionCode','versionName'],'the pilot as the card shows it');
eq((await ask('POST',{action:'other',versionCode:c1},owner)).status,400,'an unknown action: 400');
for(const bad of [0,-1,1.5,'18',null,10_000_000])eq((await ask('POST',{action:'approve',versionCode:bad},owner)).status,400,'a bad version number: 400 '+JSON.stringify(bad));
eq((await ask('POST',{action:'approve',versionCode:c3},owner)).status,404,'a version that is not a pilot: 404');
session.origin=false;eq((await ask('POST',{action:'approve',versionCode:c1},owner)).status,403,'another origin: 403');session.origin=true;
eq(row(),null,'still nothing approved');
answer=await ask('POST',{action:'approve',versionCode:c1},owner);
eq([answer.status,answer.body],[200,{ok:true,served:{versionName:n1,versionCode:c1}}],'the first pilot approved');
eq([JSON.parse(row()).versionCode,JSON.parse(row()).approvedBy],[c1,'owner'],'kept with the owner\'s id');
eq((await (await served.GET()).json()).versionCode,c1,'/api/app-update now serves it: every phone older must update');
answer=await ask('GET',null,owner);
eq([answer.body.pilot?.versionCode,answer.body.served.versionCode,answer.body.approval?.versionCode],[c2,c1,c1],'the second pilot is still offered');
eq((await ask('POST',{action:'approve',versionCode:c1},owner)).status,409,'approved again: 409');
eq((await ask('POST',{action:'approve',versionCode:c2},owner)).status,200,'the second approved');
eq([(await ask('GET',null,owner)).body.pilot,(await (await served.GET()).json()).versionCode],[null,c2],'nothing left to try, the second served');
eq((await ask('POST',{action:'approve',versionCode:c1},owner)).status,409,'an older pilot cannot be approved back: 409 (never moved back)');

// ---- 4. the scripts, in a folder of their own
const work=fs.mkdtempSync(path.join(os.tmpdir(),'yr-release-pilot-'));
process.on('exit',()=>fs.rmSync(work,{recursive:true,force:true}));
for(const file of ['scripts/publish-android-release.mjs','scripts/promote-android-pilot.mjs','lib/app-update-release.json','public/app-update.json']){fs.mkdirSync(path.join(work,path.dirname(file)),{recursive:true});fs.copyFileSync(path.join(root,file),path.join(work,file));}
fs.writeFileSync(path.join(work,'lib/app-update-pilots.json'),'[]\n');
fs.mkdirSync(path.join(work,'public/downloads'),{recursive:true});
const baseApk=Buffer.from('BASE APK '+BASE.versionName);fs.writeFileSync(path.join(work,'public/downloads/yourrest-crm-android.apk'),baseApk);
const gradle=(name,code)=>{fs.mkdirSync(path.join(work,'mobile/android/app'),{recursive:true});fs.writeFileSync(path.join(work,'mobile/android/app/build.gradle'),`android {\n defaultConfig {\n  versionCode ${code}\n  versionName '${name}'\n }\n}\n`);};
const build=(name,code)=>{const bytes=Buffer.from('APK '+name+' '+code+' '+'x'.repeat(code));const apk=path.join(work,'build-'+code+'.apk'),report=path.join(work,'build-'+code+'.json');fs.writeFileSync(apk,bytes);fs.writeFileSync(report,JSON.stringify({package:'org.yourrest.crm',versionName:name,versionCode:code,apkSha256:createHash('sha256').update(bytes).digest('hex'),apkBytes:bytes.length,certificateSha256:CERT}));gradle(name,code);return [apk,report,bytes];};
const run=(script,...args)=>execFileSync(process.execPath,[path.join(work,'scripts',script),...args],{cwd:work,encoding:'utf8',stdio:['ignore','pipe','pipe']});
const read=file=>fs.readFileSync(path.join(work,file),'utf8');
const baseBefore=[read('lib/app-update-release.json'),read('public/app-update.json')];
let [apk,rep1]=build(n1,c1);run('publish-android-release.mjs',apk,rep1);
eq([read('lib/app-update-release.json'),read('public/app-update.json'),fs.readFileSync(path.join(work,'public/downloads/yourrest-crm-android.apk')).equals(baseApk)],[...baseBefore,true],'a new build: the base files and the unversioned APK untouched');
let pilots=JSON.parse(read('lib/app-update-pilots.json'));
eq(pilots.map(item=>[item.versionCode,item.minimumVersionCode]),[[c1,c1]],'listed as a pilot');
ok(fs.existsSync(path.join(work,`public/downloads/yourrest-crm-android-v${n1}-${c1}.apk`)),'its file is on the site');
eq(A.publishedReleases(BASE,pilots).pilots.length,1,'and it parses as a release of this app');
[apk,rep1]=build(n1,c1);run('publish-android-release.mjs',apk,rep1);
eq(JSON.parse(read('lib/app-update-pilots.json')).length,1,'published again: replaced, not listed twice');
const [apk2,rep2]=build(n2,c2);run('publish-android-release.mjs',apk2,rep2);
eq(JSON.parse(read('lib/app-update-pilots.json')).map(item=>item.versionCode),[c1,c2],'a second pilot, oldest first');
const [apk0,rep0]=build(BASE.versionName,BASE.versionCode);
assert.throws(()=>run('publish-android-release.mjs',apk0,rep0),/newer than the base/);ok(true,'a pilot not newer than the base is refused');
assert.throws(()=>run('promote-android-pilot.mjs',String(c3)),/No pilot/);ok(true,'promoting a version that is not a pilot is refused');
fs.writeFileSync(path.join(work,`public/downloads/yourrest-crm-android-v${n1}-${c1}.apk`),'changed');
assert.throws(()=>run('promote-android-pilot.mjs',String(c1)),/differs/);ok(true,'promoting a pilot whose file changed is refused');
eq([read('lib/app-update-release.json'),fs.readFileSync(path.join(work,'public/downloads/yourrest-crm-android.apk')).equals(baseApk)],[baseBefore[0],true],'and nothing moved');
const [apk1b,rep1b,bytes1]=build(n1,c1);run('publish-android-release.mjs',apk1b,rep1b);
eq(JSON.parse(run('promote-android-pilot.mjs',String(c1))),{promoted:n1,versionCode:c1,pilotsLeft:1},'the approved pilot promoted');
const promoted=JSON.parse(read('lib/app-update-release.json'));
eq([promoted.versionCode,promoted.minimumVersionCode,read('public/app-update.json')===read('lib/app-update-release.json'),fs.readFileSync(path.join(work,'public/downloads/yourrest-crm-android.apk')).equals(bytes1)],[c1,c1,true,true],'it is the base now: both manifests and the unversioned APK');
eq(JSON.parse(read('lib/app-update-pilots.json')).map(item=>item.versionCode),[c2],'the newer pilot stays a pilot');
eq(A.servedRelease(c1,A.publishedReleases(promoted,JSON.parse(read('lib/app-update-pilots.json')))).versionCode,c1,'with the approval of the live site the same version is served before and after');
const [apk3,rep3,bytes3]=build(n3,c3);run('publish-android-release.mjs',apk3,rep3,'--base');
eq([JSON.parse(read('lib/app-update-release.json')).versionCode,fs.readFileSync(path.join(work,'public/downloads/yourrest-crm-android.apk')).equals(bytes3),JSON.parse(read('lib/app-update-pilots.json')).map(item=>item.versionCode)],[c3,true,[c2]],'--base: made mandatory at once, the pilots file left as it was');

report();
