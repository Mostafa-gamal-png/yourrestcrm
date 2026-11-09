// The supervisor's notes on a member's work (lib/supervisor-reviews*.ts, migration 0019; GSCO tests/security-review-inbox.test.cjs):
// the rules (who writes, on whom, the two fields' limits, a read per version), the routes /api/reviews and /api/review-inbox on an
// isolated in-memory SQLite (the route modules compiled as the build does, the session faked), GET /api/crm keeping the notes and their
// reads out of its recent changes, and migration 0019 on a fresh database and on one of 19 migrations. Synthetic people only; no build,
// no network, no production data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {initializeDatabase,inspectInitializedDatabase} from '../portable/initialize.mjs';
import {upgradeExistingDatabase} from '../portable/upgrade.mjs';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'supervisor-reviews-')),work=fs.mkdtempSync(path.join(os.tmpdir(),'yourrest-supervisor-reviews-')),seen=new Set();
process.on('exit',()=>{fs.rmSync(out,{recursive:true,force:true});fs.rmSync(work,{recursive:true,force:true});});
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};

// ---- 1. Migration 0019: twenty migrations, a fresh database and the upgrade of a 19-migration one (portable/initialize.mjs, upgrade.mjs).
const NEW='0019_supervisor_reviews.sql';
const all=fs.readdirSync(path.join(root,'drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).sort(),before=all.filter(name=>name<NEW);
eq([all.length,all.at(-1),before.length],[20,NEW,19],'twenty migrations, the newest the supervisor reviews');
const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
{
 const schema=new DatabaseSync(':memory:');for(const name of before)schema.exec(fs.readFileSync(path.join(root,'drizzle',name),'utf8'));
 const seedTables=['crm_members','crm_settings','crm_records','crm_visit_numbers','crm_visit_files','crm_sales','crm_performance_targets','crm_target_sets','crm_kpi_assessments','crm_service_cases','crm_audit'];
 const tables=Object.fromEntries(seedTables.map(table=>[table,{columns:[schema.prepare(`PRAGMA table_info("${table}")`).all()[0].name],rows:[]}]));schema.close();
 tables.crm_members={columns:['id','user_id','email','name','role','branch','created_at','region_scope'],rows:[{id:'owner',user_id:'synthetic-owner',email:'reviews-test@yourrest.org',name:'Synthetic owner',role:'admin',branch:'test',created_at:'2026-11-01T00:00:00Z',region_scope:'all'}]};
 tables.crm_settings={columns:['id','owner_id'],rows:[{id:'company',owner_id:'synthetic-owner'}]};
 tables.crm_records={columns:['id','kind','assigned_to','branch','data','created_at','updated_at'],rows:[{id:'synthetic-customer',kind:'customer',assigned_to:'owner',branch:'test',data:'{"name":"Synthetic factory"}',created_at:'2026-11-01T00:00:00Z',updated_at:'2026-11-01T00:00:00Z'}]};
 const seed=path.join(work,'seed.json'),checksum=path.join(work,'seed.sha256');
 fs.writeFileSync(seed,JSON.stringify({format:'yourrest-namecheap-export-v1',tables}));fs.writeFileSync(checksum,digest(seed));
 const fixture=(name,names)=>{
  const appRoot=path.join(work,name,'app'),migrations=path.join(appRoot,'release','drizzle'),data=path.join(work,name,'private-data');
  fs.mkdirSync(migrations,{recursive:true,mode:0o700});fs.mkdirSync(data,{mode:0o700});
  for(const file of names)fs.copyFileSync(path.join(root,'drizzle',file),path.join(migrations,file));
  fs.writeFileSync(path.join(migrations,'manifest.json'),JSON.stringify({format:'yourrest-migrations-v1',files:names.map(file=>({name:file,sha256:digest(path.join(migrations,file))}))}));
  return{filename:path.join(data,'database.sqlite'),migrations,appRoot,seed,checksum};
 };
 const read=(filename,fn)=>{const db=new DatabaseSync(filename,{readOnly:true});try{return fn(db);}finally{db.close();}};
 const reviewTables=db=>db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('crm_daily_entry_reviews','crm_daily_report_reviews') ORDER BY name").all().map(row=>row.name);
 const fresh=fixture('fresh',all);
 eq(initializeDatabase(fresh).migrations,20,'a new database takes the twenty migrations');
 eq(read(fresh.filename,reviewTables),['crm_daily_entry_reviews','crm_daily_report_reviews'],'with both review tables');
 const old=fixture('upgrade',before);
 eq(initializeDatabase(old).migrations,19,'the live schema: 19 migrations');
 const live=new DatabaseSync(old.filename);live.exec("INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES('kept','synthetic-customer','Synthetic owner','تعديل','{}','2026-11-02T00:00:00Z')");live.close();
 fs.copyFileSync(path.join(root,'drizzle',NEW),path.join(old.migrations,NEW));
 fs.writeFileSync(path.join(old.migrations,'manifest.json'),JSON.stringify({format:'yourrest-migrations-v1',files:all.map(file=>({name:file,sha256:digest(path.join(old.migrations,file))}))}));
 eq(inspectInitializedDatabase(old),{pending:[NEW],migrations:20},'0019 is the one pending migration');
 const upgraded=await upgradeExistingDatabase(old);
 eq([upgraded.upgraded,upgraded.migrations,path.basename(upgraded.backup).startsWith('before-0019_supervisor_reviews-')],[true,20,true],'the upgrade applies it after a private schema backup');
 eq(read(upgraded.backup,db=>[db.prepare('SELECT COUNT(*) n FROM yr_schema_migrations').get().n,reviewTables(db)]),[19,[]],'the backup is the 19-migration database');
 eq(read(old.filename,db=>[db.prepare('SELECT COUNT(*) n FROM yr_schema_migrations').get().n,reviewTables(db),db.prepare("SELECT id FROM crm_audit").all().map(row=>row.id),db.prepare("SELECT COUNT(*) n FROM crm_records").get().n]),[20,['crm_daily_entry_reviews','crm_daily_report_reviews'],['kept'],1],'the upgraded database keeps its data and gains the two tables');
 const db=new DatabaseSync(old.filename);
 assert.throws(()=>db.prepare("INSERT INTO crm_daily_entry_reviews(activity_id,member_id,date,result,action,reviewed_by,version,mutation_id,created_at,updated_at) VALUES('a','m','2026-11-09','نتيجة','إجراء','s',0,'x','t','t')").run(),/CHECK/);checks++;
 db.close();
}

// ---- 2. The shared rules.
function compile(relative){if(seen.has(relative))return;seen.add(relative);const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';compile(source);return 'from '+JSON.stringify(path.join(out,source.replace(/\.tsx?$/,'.mjs')));});fs.writeFileSync(dest,code);}
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const u=globalThis.testUser;if(!u)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version FROM crm_members WHERE user_id=?').bind(u.userId).first();return {...u,provider:'email-otp',memberId:m?.id||'missing',memberVersion:m?.auth_version};}`);
for(const name of ['reviews','review-inbox','crm'])compile('app/api/'+name+'/route.ts');
const rules=await import(pathToFileURL(path.join(out,'lib/supervisor-reviews.mjs')));
eq(['admin','manager','supervisor','rep','customer_service','customer_service_manager'].map(role=>rules.canWriteReviews({role,active:1})),[true,true,true,false,false,false],'the administrator, a sales manager and a supervisor write notes');
eq(rules.canWriteReviews({role:'supervisor',active:0}),false,'an inactive supervisor does not');
eq([undefined,'',' x ','ab','  ab  ','a'.repeat(2000),'a'.repeat(2001),'ok\u0007','سطر\nسطر\tآخر'].map(rules.reviewTextProblem),['short','short','short',null,null,null,'long','short',null],'both fields: 2..2000 characters after trimming, no control characters');
eq([rules.entryReadId('act-1',3),rules.dayReadId('rep1','2026-11-09',2)],['review-read:entry:act-1:3','review-read:day:rep1:2026-11-09:2'],'a read names the note and its version');
eq(rules.REVIEW_AUDIT_ACTIONS,['مراجعة المشرف لزيارة أو متابعة','مراجعة المشرف لتقرير اليوم','قراءة مراجعة المشرف'],'the three audit actions');
eq([rules.REVIEW_INBOX_DAYS,rules.REVIEW_INBOX_LIMIT,rules.REVIEW_INBOX_INTERVAL_MS,rules.REVIEW_INBOX_FOCUS_MS],[30,50,300000,60000],'30 days, 50 notes, every 5 minutes, focus at most once a minute');

// ---- 3. The routes on an isolated database.
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const name of all)sql.exec(fs.readFileSync(path.join(root,'drizzle',name),'utf8'));
let race=null;
class Statement{constructor(q,a=[]){this.q=q;this.a=a;}bind(...a){return new Statement(this.q,a);}async run(){const r=sql.prepare(this.q).run(...this.a);return{meta:{changes:Number(r.changes)}};}async all(){return{results:sql.prepare(this.q).all(...this.a)};}async first(){return sql.prepare(this.q).get(...this.a)||null;}}
const DB={prepare:q=>new Statement(q),batch:async statements=>{if(race){const fn=race;race=null;await fn();}sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(/^\s*(SELECT|WITH)/i.test(s.q)?{...await s.all(),meta:{changes:0}}:await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid'};
const now=new Date().toISOString(),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const tomorrow=new Date(Date.parse(day+'T12:00:00Z')+86400000).toISOString().slice(0,10);
const member=(id,role,supervisor=null,region='eastern')=>sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,1,0,?)').run(id,'u-'+id,id+'@yourrest.org','اسم '+id,role,'الرئيسي',supervisor,region,now);
member('owner','admin',null,'all');member('mgr','manager',null,'all');member('sup','supervisor','mgr');member('sup2','supervisor','mgr');
member('rep1','rep','sup');member('rep2','rep','sup2');member('cs','customer_service','mgr');
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-owner')").run();
const record=(id,kind,parent,assigned,data,at=now)=>sql.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').run(id,kind,parent,assigned,'الرئيسي',JSON.stringify(data),at,at);
record('c1','customer',null,'rep1',{name:'مصنع الشرق',region:'الشرقية',city:'الدمام',location:'26.43, 50.03'});
const visit=(id,by,type='visit',date=day)=>record(id,'activity','c1',by,{type,date,summary:'تعريف',result:'تمت',performedBy:by,responsibleId:by,recordedByEmail:by+'@yourrest.org'});
visit('v1','rep1');visit('v2','rep2','call');visit('v3','sup');visit('v4','rep1','call');
const user=id=>{globalThis.testUser=id?{userId:'u-'+id,email:id+'@yourrest.org',fullName:id}:null;};
const reviews=await import(pathToFileURL(path.join(out,'app/api/reviews/route.mjs'))),inbox=await import(pathToFileURL(path.join(out,'app/api/review-inbox/route.mjs'))),crm=await import(pathToFileURL(path.join(out,'app/api/crm/route.mjs')));
const call=async(handler,{as,body,url='https://test.invalid/api/x',origin='https://test.invalid'},status=200)=>{
 user(as);const request=body===undefined?new Request(url):new Request(url,{method:'POST',headers:{origin,'content-type':'application/json'},body:typeof body==='string'?body:JSON.stringify(body)});
 const response=await handler(request),data=await response.json();eq(response.status,status,(as||'anonymous')+' '+url+' '+JSON.stringify(body||'').slice(0,120)+' -> '+JSON.stringify(data).slice(0,300));return data;
};
const save=(as,body,status)=>call(reviews.POST,{as,body:{requestId:crypto.randomUUID(),version:null,...body}},status);
const entry=(as,activityId,extra={},status)=>save(as,{kind:'entry',activityId,result:'زيارة جيدة',action:'جهّز عرض السعر',...extra},status);
const dayNote=(as,memberId,extra={},status)=>save(as,{kind:'day',memberId,date:day,result:'يوم منظم',action:'زد الزيارات غدًا',...extra},status);
const report=(as,memberId,status)=>call(reviews.GET,{as,url:'https://test.invalid/api/reviews?date='+day+(memberId?'&memberId='+memberId:'')},status);
const unread=as=>call(inbox.GET,{as});
const read=(as,items,status)=>call(inbox.POST,{as,body:{items}},status);
const reads=()=>sql.prepare("SELECT COUNT(*) n FROM crm_audit WHERE action='قراءة مراجعة المشرف'").get().n;

// Anonymous and foreign callers.
for(const handler of [reviews.GET,inbox.GET])await call(handler,{as:null,url:'https://test.invalid/api/reviews?date='+day},401);
for(const handler of [reviews.POST,inbox.POST])await call(handler,{as:null,body:{}},401);
await call(reviews.POST,{as:'sup',body:{},origin:'https://evil.example'},403);
await call(inbox.POST,{as:'rep1',body:{},origin:'https://evil.example'},403);
// Who writes: not a representative nor customer service.
await entry('rep1','v4',{},403);await entry('cs','v1',{},403);await dayNote('rep1','rep2',{},403);
// On whom: the supervisor's own representative; not another team's, not their own work, not a day to come.
eq(sql.prepare('SELECT COUNT(*) n FROM crm_daily_entry_reviews').get().n,0,'nothing written yet');
await entry('sup','v2',{},403);await entry('sup','v3',{},400);await entry('sup','missing-activity',{},404);
await dayNote('sup','rep2',{},403);await dayNote('sup','sup',{},400);await dayNote('sup','rep1',{date:tomorrow},400);await dayNote('sup','ghost',{},403);
// The two fields.
for(const [result,action] of [['',''],['x','إجراء'],['نتيجة',' '],['نتيجة\u0001','إجراء']])eq((await entry('sup','v1',{result,action},400)).error,'اكتب النتيجة والإجراء المطلوب؛ الخانتان إلزاميتان (حرفان على الأقل).','both fields are required: '+JSON.stringify([result,action]));
eq((await entry('sup','v1',{result:'ن'.repeat(2001)},400)).error,'النتيجة والإجراء المطلوب حتى 2000 حرف لكل منهما.','2000 characters at most');
await entry('sup','v1',{surprise:true},400);await entry('sup','v1',{version:0},400);await save('sup',{kind:'day',memberId:'rep1',date:'2026-02-30',result:'نتيجة',action:'إجراء'},400);
// A note on rep1's visit.
const requestId=crypto.randomUUID();
let saved=await entry('sup','v1',{requestId,result:'  زيارة جيدة  '});
eq([saved.ok,saved.kind,saved.review.activityId,saved.review.memberId,saved.review.date,saved.review.result,saved.review.version,saved.review.reviewedBy,saved.review.reviewedByName,saved.review.readAt],[true,'entry','v1','rep1',day,'زيارة جيدة',1,'sup','اسم sup',null],'saved, trimmed, version 1, not read');
// The same request again answers with the saved note (one row, one audit); the same request with other words is a conflict.
eq((await entry('sup','v1',{requestId,result:'زيارة جيدة'})).review.version,1,'a retry of the same request answers with the saved note');
eq(sql.prepare("SELECT COUNT(*) n FROM crm_audit WHERE action='مراجعة المشرف لزيارة أو متابعة'").get().n,1,'written once');
await entry('sup','v1',{requestId,result:'كلام آخر'},409);
// A stale version: a second «add» on the same visit, or an edit of an older version.
eq((await entry('sup','v1',{},409)).error,'تغيّرت مراجعة هذه الزيارة. حدّث التقرير قبل الحفظ.','a second note over the first is refused');
await entry('sup','v1',{version:2},409);
// The day, and the sales manager's note on the supervisor's own day; the administrator on anyone's.
saved=await dayNote('sup','rep1');eq([saved.kind,saved.review.memberId,saved.review.version,saved.review.readAt],['day','rep1',1,null],'the day note');
await dayNote('sup','rep1',{},409);
await dayNote('mgr','sup',{result:'إشراف جيد',action:'راجع زيارات الفريق'});
await entry('owner','v2',{result:'اتصال مفيد',action:'تابع غدًا'});
// What the supervisor's report shows, and what the representative's report does not open.
let shown=await report('sup','rep1');
eq([shown.entries.map(e=>[e.activityId,e.readAt]),shown.reviewable.sort(),shown.day.result,shown.dayReviewable],[[['v1',null]],['v1','v4'],'يوم منظم',true],'the supervisor sees the note unread, what they may note, and the day');
eq((await report('sup')).dayReviewable,false,'their own day: nothing to write on it');
eq((await report('sup')).entries,[],'and their own visit has no note');
await report('sup','rep2',403);await report('rep1','rep1',403);await report('cs','rep1',403);
eq((await report('mgr','rep1')).reviewable.sort(),['v1','v4'],'the sales manager may note the same visits');
eq((await report('owner','all')).reviewable.sort(),['v1','v2','v3','v4'],'the administrator, every visit of the day');
// The representative's card.
let mine=await unread('rep1');
eq(mine.items.map(i=>[i.kind,i.ref,i.version,i.result,i.action,i.reviewedByName,i.customerName,i.activityType]).sort(),[['day',day,1,'يوم منظم','زد الزيارات غدًا','اسم sup','',''],['entry','v1',1,'زيارة جيدة','جهّز عرض السعر','اسم sup','مصنع الشرق','visit']],'both notes wait for the representative, the visit named');
eq([mine.ok,mine.more],[true,false],'no more');
eq((await unread('rep2')).items.map(i=>[i.ref,i.reviewedByName,i.activityType]),[['v2','اسم owner','call']],'another representative has only their own');
eq((await unread('sup')).items.map(i=>[i.kind,i.result]),[['day','إشراف جيد']],'the supervisor has the sales manager\'s note on their day');
eq((await unread('mgr')).items,[],'the sales manager has none');
// Nobody reads it for them; a wrong version reads nothing; a malformed read is refused.
await read('rep2',[{kind:'entry',ref:'v1',version:1}]);await read('sup',[{kind:'entry',ref:'v1',version:1}]);await read('rep1',[{kind:'entry',ref:'v1',version:2}]);
eq([reads(),(await unread('rep1')).items.length],[0,2],'another member\'s «قرأت» and a wrong version write nothing');
await read('rep1',[],400);await read('rep1',[{kind:'entry',ref:'v1'}],400);await read('rep1',[{kind:'day',ref:'today',version:1}],400);
await read('rep1',Array.from({length:51},(_,i)=>({kind:'entry',ref:'x'+i,version:1})),400);
// «قرأت» on the visit, twice.
mine=await read('rep1',[{kind:'entry',ref:'v1',version:1}]);
eq(mine.items.map(i=>i.kind),['day'],'the visit note is read; the day note still waits');
await read('rep1',[{kind:'entry',ref:'v1',version:1}]);
eq(reads(),1,'read once, even pressed twice');
eq({...sql.prepare("SELECT id,record_id,actor FROM crm_audit WHERE action='قراءة مراجعة المشرف'").get()},{id:'review-read:entry:v1:1',record_id:'v1',actor:'اسم rep1'},'the read is the audit row named by the note and its version');
shown=await report('sup','rep1');
ok(typeof shown.entries[0].readAt==='string'&&shown.day.readAt===null,'the supervisor sees the visit note read, and when');
// An edit is a new version: unread again, and not «read» in the report.
await entry('sup','v1',{version:1,result:'زيارة جيدة جدًا',action:'ن'.repeat(2000)});
eq((await unread('rep1')).items.map(i=>[i.kind,i.result,i.version]).sort(),[['day','يوم منظم',1],['entry','زيارة جيدة جدًا',2]],'an edited note waits again');
eq((await report('sup','rep1')).entries[0].readAt,null,'and shows as not read');
// Stale permission at commit: the representative moves to another supervisor between the decision and the write.
race=()=>sql.prepare("UPDATE crm_members SET supervisor_id='sup2' WHERE id='rep1'").run();
await entry('sup','v4',{},409);
eq(sql.prepare("SELECT COUNT(*) n FROM crm_daily_entry_reviews WHERE activity_id='v4'").get().n,0,'nothing written when the team changed meanwhile');
sql.prepare("UPDATE crm_members SET supervisor_id='sup' WHERE id='rep1'").run();
// «قرأت الكل».
const items=(await unread('rep1')).items.map(i=>({kind:i.kind,ref:i.ref,version:i.version}));
eq((await read('rep1',items)).items,[],'all read');
// The 30 days count from when the note was written or edited.
await entry('sup','v4');eq((await unread('rep1')).items.map(i=>i.ref),['v4'],'a new note');
sql.prepare("UPDATE crm_daily_entry_reviews SET updated_at=? WHERE activity_id='v4'").run(new Date(Date.now()-31*86400000).toISOString());
eq((await unread('rep1')).items,[],'a note last written more than 30 days ago no longer shows');
sql.prepare("UPDATE crm_daily_entry_reviews SET updated_at=? WHERE activity_id='v4'").run(now);
// The customer's name only within the reader's regions.
sql.prepare("UPDATE crm_members SET region_scope='western' WHERE id='rep1'").run();
eq((await unread('rep1')).items.map(i=>[i.ref,i.customerName]),[['v4','']],'outside the reader\'s regions the customer is not named');
sql.prepare("UPDATE crm_members SET region_scope='eastern' WHERE id='rep1'").run();
// The recent changes of GET /api/crm list none of it.
for(const as of ['sup','owner','rep1']){
 const state=await call(crm.GET,{as,url:'https://test.invalid/api/crm'});
 ok(Array.isArray(state.audits)&&!state.audits.some(a=>rules.REVIEW_AUDIT_ACTIONS.includes(a.action)),'GET /api/crm as '+as+': no note or read in the recent changes');
}
ok(sql.prepare('SELECT COUNT(*) n FROM crm_audit WHERE action IN (?,?,?)').get(...rules.REVIEW_AUDIT_ACTIONS).n>=7,'while they are in the audit table');
// A request body over the route's limit is refused before it is read.
await call(reviews.POST,{as:'sup',url:'https://test.invalid/api/reviews',body:JSON.stringify({kind:'entry',activityId:'v1',result:'ن'.repeat(2000),action:'ن'.repeat(2000),requestId:crypto.randomUUID(),version:null,pad:'x'.repeat(6000)})},413);
await call(inbox.POST,{as:'rep1',url:'https://test.invalid/api/review-inbox',body:JSON.stringify({items:[],pad:'x'.repeat(16001)})},413);

console.log(JSON.stringify({ok:true,checks}));
