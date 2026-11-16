// The five additions to the supervisor's notes (the owner approved them on 2026-11-15 from GSCO 2.13.66/2.13.67/2.13.71; lib/supervisor-
// reviews*.ts): 1. the evaluation of a visit or contact («فعالة» or «سلبية» chosen, «إيجابية» by itself on the sale), kept in the note's
// audit row with no new column; 2. the earlier notes on a customer (GET /api/reviews/customer); 3. «تقرير مراجعاتي» (GET
// /api/reviews/made); 4. the notice of a new note (the pure rules and the service worker's tap); 5. «قرأت» on one note at a time. The rules
// and the routes on an isolated in-memory SQLite (the route modules compiled as the build does, the session faked), who may and may not
// see and do each thing. Synthetic people only; no build, no network, no production data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'supervisor-reviews-complete-')),seen=new Set();
process.on('exit',()=>{fs.rmSync(out,{recursive:true,force:true});});
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};

function compile(relative){if(seen.has(relative))return;seen.add(relative);const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';compile(source);return 'from '+JSON.stringify(path.join(out,source.replace(/\.tsx?$/,'.mjs')));});fs.writeFileSync(dest,code);}
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const u=globalThis.testUser;if(!u)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version FROM crm_members WHERE user_id=?').bind(u.userId).first();return {...u,provider:'email-otp',memberId:m?.id||'missing',memberVersion:m?.auth_version};}`);
for(const name of ['reviews','reviews/customer','reviews/made','review-inbox'])compile('app/api/'+name+'/route.ts');
const rules=await import(pathToFileURL(path.join(out,'lib/supervisor-reviews.mjs')));

// ---- 1. The pure rules.
eq([rules.CHOSEN_RATINGS,rules.RATING_TEXT],[['effective','negative'],{positive:['إيجابية','Positive'],effective:['فعالة','Effective'],negative:['سلبية','Negative']}],'two evaluations to choose, «إيجابية» set by the system');
const sales=[[{salesStage:'won'},true],[{salesStage:'won',invoiceOutcome:'invoiced'},true],[{salesStage:'quoted',invoiceOutcome:'invoiced'},true],[{salesStage:'lost',invoiceOutcome:'invoiced'},false],[{salesStage:'lost'},false],[{salesStage:'quoted'},false],[{salesStage:''},false],[{},false],[null,false],[{invoiceOutcome:'pending'},false]];
eq(sales.map(([data])=>rules.saleEntry(data)),sales.map(([,sale])=>sale),'the sale: «تم الفوز», or «تحوّل إلى فاتورة», never a lost one');
eq([rules.entryRatingOf(true,'negative'),rules.entryRatingOf(false,'effective'),rules.entryRatingOf(false,'negative'),rules.entryRatingOf(false,'positive'),rules.entryRatingOf(false,undefined),rules.entryRatingOf(false,'x')],['positive','effective','negative','','',''],'«إيجابية» only from the sale; a stored «إيجابية» on what is no longer a sale is nothing');
{
 const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE r(id INTEGER PRIMARY KEY,data TEXT)');
 sales.forEach(([data],index)=>sql.prepare('INSERT INTO r(id,data) VALUES(?,?)').run(index,JSON.stringify(data||{})));
 eq(sql.prepare(`SELECT id,${rules.saleEntrySql('a')} AS sale FROM r a ORDER BY id`).all().map(row=>Number(row.sale)===1),sales.map(([data])=>rules.saleEntry(data||{})),'the SQL of the sale agrees with the code');
 sql.close();
}
eq(rules.reviewsMadeCounts([{memberId:'a',rating:'positive',readAt:'t'},{memberId:'a',rating:'effective',readAt:null},{memberId:'b',rating:'',readAt:null},{memberId:'b',rating:'negative',readAt:'t'}],[{memberId:'c',readAt:null}]),{notes:5,entries:4,days:1,members:3,positive:1,effective:1,negative:1,unrated:1,read:2,unread:3},'the counts of the reviews report');
eq([rules.activityTypeText('call','ar'),rules.activityTypeText('call','en'),rules.activityTypeText('','ar'),rules.activityTypeText('x','en')],['اتصال','Call','زيارة أو تواصل','Visit or contact'],'the type of a visit or contact in words');
// The notice of a new note.
const note=(ref,version=1,kind='entry',extra={})=>({kind,ref,version,date:'2026-11-15',result:'نص الملاحظة السري',action:'إجراء',reviewedByName:'المشرف سالم',updatedAt:'2026-11-15T08:00:00.000Z',customerName:'مصنع الشرق',activityType:'visit',...extra});
eq([rules.reviewNoteKey(note('v1',2)),rules.reviewNoteKey(note('2026-11-15',1,'day'))],['entry:v1:2','day:2026-11-15:1'],'a note is announced by its kind, its reference and its version');
eq([rules.reviewNoticeStorageKey('rep1'),rules.reviewAskedStorageKey('rep1')],['yourrest.review-notes.seen:rep1','yourrest.review-notes.asked:rep1'],'what the browser keeps, per member');
eq([rules.rememberedNotes(null),rules.rememberedNotes(undefined),rules.rememberedNotes('not json'),rules.rememberedNotes('{"a":1}'),rules.rememberedNotes('["entry:a:1",4,null,"day:d:1"]'),rules.rememberedNotes(JSON.stringify(Array.from({length:250},(_,i)=>'entry:'+i+':1'))).length],[null,null,null,null,['entry:a:1','day:d:1'],200],'what is remembered: a list of keys, 200 at most; anything else is nothing');
let step=rules.reviewNoticeStep([note('v1'),note('v2')],null);
eq([step.announce,step.remember],[[],['entry:v1:1','entry:v2:1']],'a browser that remembers nothing announces nothing (the card shows the notes) and remembers them');
step=rules.reviewNoticeStep([note('v3'),note('v1'),note('v2',2)],step.remember);
eq([step.announce.map(rules.reviewNoteKey),step.remember],[['entry:v3:1','entry:v2:2'],['entry:v3:1','entry:v1:1','entry:v2:2','entry:v2:1']],'a new note and an edited one are announced, once');
eq(rules.reviewNoticeStep([note('v3'),note('v1'),note('v2',2)],step.remember).announce,[],'the same notes again: nothing');
eq(rules.reviewNoticeStep(Array.from({length:3},(_,i)=>note('n'+i)),Array.from({length:200},(_,i)=>'entry:old'+i+':1')).remember.length,200,'200 keys at most');
eq(rules.reviewNoticeText([note('v1')],'ar'),{title:'ملاحظة جديدة من المشرف',body:'المشرف سالم · زيارة · مصنع الشرق'},'one note: who and on what');
eq(rules.reviewNoticeText([note('2026-11-14',1,'day',{reviewedByName:'',date:'2026-11-14'})],'en'),{title:'New note from your supervisor',body:'Supervisor · Day review 2026-11-14'},'a day note in English, the writer unknown');
eq(rules.reviewNoticeText([note('v1'),note('v2')],'ar'),{title:'ملاحظات جديدة من المشرف (2)',body:'اقرأ كل ملاحظة واضغط «قرأت» تحتها.'},'several: their count');
eq(rules.reviewNoticeText([note('v1'),note('v2'),note('v3')],'en').title,'New notes from your supervisor (3)','several in English');
ok(!JSON.stringify([rules.reviewNoticeText([note('v1')],'ar'),rules.reviewNoticeText([note('v1')],'en'),rules.reviewNoticeText([note('v1'),note('v2')],'ar')]).includes('السري'),'the notice never carries the note\'s own words (a locked screen may show it)');
const interval=rules.REVIEW_INBOX_INTERVAL_MS,now=Date.parse('2026-11-15T10:00:00Z');
eq([rules.hiddenPageMayAsk(now,null,true),rules.hiddenPageMayAsk(now,null,false),rules.hiddenPageMayAsk(now,now-60_000,true),rules.hiddenPageMayAsk(now,now-interval+30_000,true),rules.hiddenPageMayAsk(now,now+60_000,true),rules.hiddenPageMayAsk(now,Number.NaN,true)],[true,false,false,true,true,true],'a page in the background asks only for a device that may show the notice, and once an interval for all the tabs');

// ---- 2. No migration: the schema stays at 21 migrations and the review tables keep their columns.
const migrations=fs.readdirSync(path.join(root,'drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).sort();
eq([migrations.filter(name=>name<='0020_member_permissions.sql').length,migrations.filter(name=>name<='0020_member_permissions.sql').at(-1)],[21,'0020_member_permissions.sql'],'no new migration');
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const name of migrations)sql.exec(fs.readFileSync(path.join(root,'drizzle',name),'utf8'));
eq(sql.prepare('PRAGMA table_info(crm_daily_entry_reviews)').all().map(column=>column.name),['activity_id','member_id','date','result','action','reviewed_by','version','mutation_id','created_at','updated_at'],'the review table has no new column');
// Since 2026-11-15 («موافق تمام») «نسبة الزيارات الفعالة» counts the evaluation (tests/kpi-effective-visits.mjs), through these modules only.
const kpis=fs.readFileSync(path.join(root,'lib/kpis.ts'),'utf8')+fs.readFileSync(path.join(root,'lib/kpis-server.ts'),'utf8');
ok(/from '\.\/supervisor-reviews'/.test(kpis)&&/from '\.\/supervisor-reviews-server'/.test(kpis)&&!/crm_daily_entry_reviews|\$\.after\.rating/.test(kpis),'the KPIs read the evaluation through lib/supervisor-reviews*.ts, never a reading of their own');

// ---- 3. The routes on an isolated database.
class Statement{constructor(q,a=[]){this.q=q;this.a=a;}bind(...a){return new Statement(this.q,a);}async run(){const r=sql.prepare(this.q).run(...this.a);return{meta:{changes:Number(r.changes)}};}async all(){return{results:sql.prepare(this.q).all(...this.a)};}async first(){return sql.prepare(this.q).get(...this.a)||null;}}
const DB={prepare:q=>new Statement(q),batch:async statements=>{sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(/^\s*(SELECT|WITH)/i.test(s.q)?{...await s.all(),meta:{changes:0}}:await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid'};
const stamp=new Date().toISOString(),riyadh=at=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
const day=riyadh(Date.now()),yesterday=riyadh(Date.parse(day+'T12:00:00+03:00')-86_400_000),yesterdayNoon=yesterday+'T09:00:00.000Z';
const member=(id,role,supervisor=null,region='eastern')=>sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,1,0,?)').run(id,'u-'+id,id+'@yourrest.org','اسم '+id,role,'الرئيسي',supervisor,region,stamp);
member('owner','admin',null,'all');member('mgr','manager',null,'all');member('mgr2','manager',null,'all');member('sup','supervisor','mgr');member('sup2','supervisor','mgr');
member('rep1','rep','sup');member('rep2','rep','sup2');member('repw','rep','sup','western');member('cs','customer_service','mgr');
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-owner')").run();
const record=(id,kind,parent,assigned,data,at=stamp)=>sql.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').run(id,kind,parent,assigned,'الرئيسي',JSON.stringify(data),at,at);
record('c1','customer',null,'rep1',{name:'مصنع الشرق',region:'الشرقية',city:'الدمام'});
record('c2','customer',null,'rep2',{name:'مصنع الخبر',region:'الشرقية',city:'الخبر'});
record('cw','customer',null,'repw',{name:'مصنع الغرب',region:'الغربية',city:'جدة'});
const activity=(id,by,customer,extra={},date=day,at=stamp)=>record(id,'activity',customer,by,{type:'visit',date,summary:'تعريف',result:'نتيجة '+id,performedBy:by,responsibleId:by,recordedByEmail:by+'@yourrest.org',...extra},at);
activity('v1','rep1','c1',{salesStage:'quoted'});activity('v2','rep1','c1',{salesStage:'won'});
activity('f1','rep1','c1',{type:'call',visitWorkflow:'followup-v1',salesStage:'won',invoiceOutcome:'invoiced'});
activity('vlost','rep1','c1',{salesStage:'lost',invoiceOutcome:'lost'});activity('v3','rep2','c2');activity('vw','repw','cw');
activity('v4','rep1','c1',{salesStage:'quoted'},yesterday,yesterdayNoon);activity('v5','rep1','c1',{salesStage:'won'},yesterday,yesterdayNoon);
const user=id=>{globalThis.testUser=id?{userId:'u-'+id,email:id+'@yourrest.org',fullName:id}:null;};
const reviews=await import(pathToFileURL(path.join(out,'app/api/reviews/route.mjs'))),customerRoute=await import(pathToFileURL(path.join(out,'app/api/reviews/customer/route.mjs'))),madeRoute=await import(pathToFileURL(path.join(out,'app/api/reviews/made/route.mjs'))),inbox=await import(pathToFileURL(path.join(out,'app/api/review-inbox/route.mjs')));
const call=async(handler,{as,body,url='https://test.invalid/api/x'},status=200)=>{
 user(as);const request=body===undefined?new Request(url):new Request(url,{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json'},body:JSON.stringify(body)});
 const response=await handler(request),data=await response.json();eq(response.status,status,(as||'anonymous')+' '+url+' '+JSON.stringify(body||'').slice(0,120)+' -> '+JSON.stringify(data).slice(0,300));
 if(status===200)eq(response.headers.get('cache-control'),'no-store',url+': never cached');
 return data;
};
const save=(as,body,status)=>call(reviews.POST,{as,body:{requestId:crypto.randomUUID(),version:null,result:'زيارة جيدة',action:'جهّز عرض السعر',...body}},status);
const entry=(as,activityId,extra={},status)=>save(as,{kind:'entry',activityId,...extra},status);
const notesOf=(as,customerId,status)=>call(customerRoute.GET,{as,url:'https://test.invalid/api/reviews/customer?customerId='+customerId},status);
const made=(as,query='',status,date=day)=>call(madeRoute.GET,{as,url:'https://test.invalid/api/reviews/made?date='+date+query},status);
const unread=as=>call(inbox.GET,{as});
const read=(as,items,status)=>call(inbox.POST,{as,body:{items}},status);
const reads=()=>sql.prepare("SELECT COUNT(*) n FROM crm_audit WHERE action='قراءة مراجعة المشرف'").get().n;
const stored=activityId=>{const row=sql.prepare('SELECT a.detail FROM crm_daily_entry_reviews r JOIN crm_audit a ON a.id=r.mutation_id WHERE r.activity_id=?').get(activityId);return row?JSON.parse(row.detail).after.rating:undefined;};
const hide=(id,hidden,extra={})=>sql.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_by,updated_at) VALUES(?,?,?,1,'owner',?) ON CONFLICT(member_id) DO UPDATE SET permissions=excluded.permissions,hidden=excluded.hidden,version=version+1").run(id,JSON.stringify(extra),JSON.stringify(hidden),stamp);
const unhide=id=>sql.prepare('DELETE FROM crm_member_permissions WHERE member_id=?').run(id);

// 3.1 The evaluation is required on a visit or contact that is not a sale, and only «فعالة» or «سلبية» may be chosen.
eq((await entry('sup','v1',{},400)).error,'اختر تقييم الزيارة أو التواصل: فعالة أو سلبية.','no evaluation: refused');
for(const rating of ['great','positive','',0])eq((await entry('sup','v1',{rating},400)).error,'بيانات المراجعة غير صحيحة.','not a choice: '+JSON.stringify(rating));
eq(sql.prepare('SELECT COUNT(*) n FROM crm_daily_entry_reviews').get().n,0,'nothing written');
// Who may write is unchanged: the role and the scope are checked before the evaluation.
eq((await entry('rep1','v2',{rating:'effective'},403)).error,'كتابة النتيجة والإجراء المطلوب متاحة لمدير النظام ومدير المبيعات والمشرف فقط.','a representative: 403');
await entry('cs','v1',{rating:'effective'},403);await entry('sup','v3',{rating:'effective'},403);await entry('sup2','v1',{},403);
let saved=await entry('sup','v1',{rating:'effective'});
eq([saved.review.rating,stored('v1'),saved.review.version],['effective','effective',1],'«فعالة» saved in the note\'s audit row');
saved=await entry('sup','v2',{});eq([saved.review.rating,stored('v2')],['positive','positive'],'the sale needs no choice: «إيجابية» by itself');
saved=await entry('sup','f1',{rating:'negative'});eq([saved.review.rating,stored('f1')],['positive','positive'],'a follow-up that turned into an invoice is «إيجابية» whatever was sent');
await entry('sup','vlost',{},400);
saved=await entry('sup','vlost',{rating:'negative'});eq(saved.review.rating,'negative','a lost visit is no sale: «سلبية» chosen');
// A day note has no evaluation.
await save('sup',{kind:'day',memberId:'rep1',date:day,rating:'effective'},400);
saved=await save('sup',{kind:'day',memberId:'rep1',date:day});eq([saved.kind,'rating' in saved.review],['day',false],'the day note: no evaluation');
// An edit asks again; the same request with another evaluation is a conflict.
await entry('sup','v1',{version:1,result:'زيارة متوسطة'},400);
const editId=crypto.randomUUID();
saved=await entry('sup','v1',{version:1,result:'زيارة متوسطة',rating:'negative',requestId:editId});eq([saved.review.version,saved.review.rating,saved.review.result],[2,'negative','زيارة متوسطة'],'the edit: version 2, «سلبية»');
eq((await entry('sup','v1',{version:1,result:'زيارة متوسطة',rating:'negative',requestId:editId})).review.version,2,'a retry answers from its receipt');
await entry('sup','v1',{version:1,result:'زيارة متوسطة',rating:'effective',requestId:editId},409);
// A note saved before the evaluation existed (its audit row has no rating): shown without one; on a sale, «إيجابية» from the visit.
const oldNote=(activityId,reviewer)=>{const id='review-entry:'+reviewer+':'+crypto.randomUUID();sql.prepare('INSERT INTO crm_daily_entry_reviews(activity_id,member_id,date,result,action,reviewed_by,version,mutation_id,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?,?)').run(activityId,'rep1',yesterday,'ملاحظة قديمة','إجراء قديم',reviewer,id,yesterdayNoon,yesterdayNoon);sql.prepare('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES(?,?,?,?,?,?)').run(id,activityId,'اسم '+reviewer,'مراجعة المشرف لزيارة أو متابعة',JSON.stringify({before:null,after:{activityId,memberId:'rep1',date:yesterday,result:'ملاحظة قديمة',action:'إجراء قديم',reviewedBy:reviewer,version:1}}),yesterdayNoon);};
oldNote('v4','sup');oldNote('v5','sup');
let report=await call(reviews.GET,{as:'sup',url:'https://test.invalid/api/reviews?date='+yesterday+'&memberId=rep1'});
eq(Object.fromEntries(report.entries.map(e=>[e.activityId,e.rating])),{v4:'',v5:'positive'},'an old note has no evaluation, unless its visit is the sale');
eq(report.sales,['v5'],'and the report names the sales');
report=await call(reviews.GET,{as:'sup',url:'https://test.invalid/api/reviews?date='+day+'&memberId=rep1'});
eq([Object.fromEntries(report.entries.map(e=>[e.activityId,e.rating])),[...report.sales].sort()],[{v1:'negative',v2:'positive',f1:'positive',vlost:'negative'},['f1','v2']],'the day report: each note\'s evaluation, and which visits are sales');
let mine=await unread('rep1');
eq(Object.fromEntries(mine.items.map(i=>[i.kind+':'+i.ref,i.rating??'none'])),{['day:'+day]:'none','entry:v1':'negative','entry:v2':'positive','entry:f1':'positive','entry:vlost':'negative','entry:v4':'','entry:v5':'positive'},'the card carries each evaluation (none on a day note, empty on an old one)');

// 3.2 «قرأت» names one note: two at once are refused and write nothing.
const before=reads();
eq((await read('rep1',[{kind:'entry',ref:'v1',version:2},{kind:'entry',ref:'v2',version:1}],400)).error,'اضغط «قرأت» على كل ملاحظة وحدها.','two at once: refused');
eq(reads(),before,'nothing written');
mine=await read('rep1',[{kind:'entry',ref:'v2',version:1}]);
eq([reads(),mine.items.some(i=>i.ref==='v2')],[before+1,false],'one at a time');
await read('rep2',[{kind:'entry',ref:'v1',version:2}]);eq(reads(),before+1,'another member\'s «قرأت» still writes nothing');
eq((await call(reviews.GET,{as:'sup',url:'https://test.invalid/api/reviews?date='+day+'&memberId=rep1'})).entries.filter(e=>e.readAt).map(e=>e.activityId),['v2'],'reads saved earlier and now both show');

// 3.3 The earlier notes on a customer: a representative their own work, a reviewer their team as the day report shows it.
await entry('owner','v3',{rating:'effective',result:'اتصال مفيد'});
await call(customerRoute.GET,{as:null,url:'https://test.invalid/api/reviews/customer?customerId=c1'},401);
let notes=await notesOf('rep1','c1');
eq(notes.notes.map(n=>[n.activityId,n.rating,n.memberId]).sort(),[['f1','positive','rep1'],['v1','negative','rep1'],['v2','positive','rep1'],['v4','','rep1'],['v5','positive','rep1'],['vlost','negative','rep1']],'the representative: every note on their own visits of this customer, with its evaluation');
eq([notes.notes.slice(0,4).every(n=>n.date===day),notes.notes.slice(-2).map(n=>n.date),notes.more],[true,[yesterday,yesterday],false],'newest visit first');
eq(notes.notes.find(n=>n.activityId==='f1')&&[notes.notes.find(n=>n.activityId==='f1').followup,notes.notes.find(n=>n.activityId==='f1').activityType,notes.notes.find(n=>n.activityId==='v1').result,notes.notes.find(n=>n.activityId==='v1').reviewedByName],[true,'call','زيارة متوسطة','اسم sup'],'a follow-up is marked, with the words and the writer');
eq((await notesOf('rep2','c1')).notes,[],'another representative of the same region: none of rep1\'s notes');
eq((await notesOf('rep2','c2')).notes.map(n=>n.activityId),['v3'],'but their own');
eq((await notesOf('rep1','c2')).notes,[],'and rep1 none of theirs');
eq((await notesOf('sup','c1')).notes.length,6,'the supervisor: their team\'s notes');
eq((await notesOf('sup2','c1')).notes,[],'another supervisor: none');
hide('sup2',[],{viewAll:true});eq((await notesOf('sup2','c1')).notes,[],'«عرض بيانات الفريق بالكامل» widens nothing here (the day report shows no note of another team either)');unhide('sup2');
eq([(await notesOf('mgr','c1')).notes.length,(await notesOf('owner','c2')).notes.length],[6,1],'the sales manager and the administrator: their scope');
for(const [as,customerId] of [['cs','c1'],['repw','c1'],['rep1','cw'],['rep1','missing'],['rep1','']])await notesOf(as,customerId,404);
hide('sup',['journeys']);eq((await notesOf('sup','c1')).notes,[],'a supervisor without «تقرير يوم المندوب»: only their own work (none here)');unhide('sup');
eq(reads(),before+1,'reading the notes here is not «قرأت»');

// 3.4 «تقرير مراجعاتي».
await call(madeRoute.GET,{as:null,url:'https://test.invalid/api/reviews/made?date='+day},401);
for(const as of ['rep1','cs'])await made(as,'',403);
let mineMade=await made('sup');
eq([mineMade.reviewerId,mineMade.reviewers.map(r=>r.id)],['sup',['sup']],'a supervisor: their own reviews, nobody else to choose');
eq(mineMade.entries.map(e=>[e.activityId,e.rating,e.memberName,e.customerName]),[['v1','negative','اسم rep1','مصنع الشرق'],['v2','positive','اسم rep1','مصنع الشرق'],['f1','positive','اسم rep1','مصنع الشرق'],['vlost','negative','اسم rep1','مصنع الشرق']],'each note of the day in the order first saved, with the member, the customer and the evaluation');
const v1=mineMade.entries[0];
eq([v1.result,v1.action,v1.version,v1.memberResult,v1.activityType,v1.followup,v1.createdAt<v1.savedAt],['زيارة متوسطة','جهّز عرض السعر',2,'نتيجة v1','visit',false,true],'the last save of the day, what the representative recorded, first and last save');
eq([mineMade.entries.find(e=>e.activityId==='v2').readAt!==null,mineMade.entries.find(e=>e.activityId==='f1').readAt],[true,null],'whether the member read it');
eq(mineMade.days.map(d=>[d.memberId,d.date,d.result]),[['rep1',day,'زيارة جيدة']],'the day note');
eq(mineMade.counts,{notes:5,entries:4,days:1,members:1,positive:2,effective:0,negative:2,unrated:0,read:1,unread:4},'the counts');
const old=await made('sup','',200,yesterday);
eq([old.date,old.entries.map(e=>[e.activityId,e.rating]),old.counts.unrated],[yesterday,[['v4',''],['v5','positive']],1],'yesterday: the notes saved yesterday, an old one without evaluation');
for(const reviewerId of ['sup2','mgr','owner','rep1'])await made('sup','&reviewerId='+reviewerId,403);
hide('sup',[],{viewAll:true});await made('sup','&reviewerId=sup2',403);unhide('sup');
await save('mgr',{kind:'day',memberId:'sup',date:day,result:'إشراف جيد',action:'راجع زيارات الفريق'});
const mgrOwn=await made('mgr');
eq([mgrOwn.reviewerId,mgrOwn.reviewers.map(r=>r.id),mgrOwn.entries,mgrOwn.days.map(d=>d.memberId)],['mgr',['mgr','sup','sup2'],[],['sup']],'a sales manager: their own by default, their supervisors to choose');
eq((await made('mgr','&reviewerId=sup')).entries.map(e=>e.activityId),['v1','v2','f1','vlost'],'and a supervisor\'s day');
for(const reviewerId of ['mgr2','owner','rep1','ghost'])await made('mgr','&reviewerId='+reviewerId,403);
const ownerMade=await made('owner','&reviewerId=mgr2');
eq([ownerMade.entries,ownerMade.reviewers.map(r=>r.id).sort()],[[],['mgr','mgr2','owner','sup','sup2']],'the administrator: any reviewer');
eq((await made('owner')).entries.map(e=>[e.activityId,e.memberName]),[['v3','اسم rep2']],'the administrator\'s own');
// A visit deleted since is left out; a page the administrator hid answers 404; a bad day 400.
sql.prepare("DELETE FROM crm_records WHERE id='vlost'").run();
eq((await made('sup')).entries.map(e=>e.activityId),['v1','v2','f1'],'a deleted visit is left out');
hide('sup',['journeys']);await made('sup','',404);unhide('sup');
await call(madeRoute.GET,{as:'sup',url:'https://test.invalid/api/reviews/made?date=2026-02-30'},400);
// The limit of the earlier notes: 20, and more says there are others.
for(let i=0;i<20;i++){activity('bulk'+i,'rep1','c1',{salesStage:'quoted'},yesterday,yesterdayNoon);oldNote('bulk'+i,'sup');}
notes=await notesOf('rep1','c1');eq([notes.notes.length,notes.more],[20,true],'twenty at most, «more» says so');

// ---- 4. The device's notice: a tap on a note's notification brings the CRM to the front, or opens it; any other notification is ignored.
const worker=fs.readFileSync(path.join(root,'public/sw.js'),'utf8');
async function tap(tag,windows){
 const listeners=new Map(),calls=[];let work=Promise.resolve();
 vm.runInNewContext(worker,{URL,Response,self:{location:{origin:'https://crm.yourrest.org'},addEventListener:(name,listener)=>listeners.set(name,listener),clients:{claim:async()=>{},matchAll:async options=>{calls.push(['matchAll',options]);return windows.map(url=>({url,focus:async()=>{calls.push(['focus',url]);}}));},openWindow:async url=>{calls.push(['open',url]);}}}});
 listeners.get('notificationclick')({notification:{tag,close:()=>calls.push(['close'])},waitUntil:promise=>{work=promise;}});
 await work;return JSON.parse(JSON.stringify(calls));
}
eq(await tap('yourrest-review:entry:v1:1',['https://other.example/','https://crm.yourrest.org/#journeys']),[['close'],['matchAll',{type:'window',includeUncontrolled:true}],['focus','https://crm.yourrest.org/#journeys']],'an open page of the CRM comes to the front');
eq(await tap('yourrest-review:day:2026-11-15:1',[]),[['close'],['matchAll',{type:'window',includeUncontrolled:true}],['open','/']],'or the CRM opens');
eq(await tap('another-notice',['https://crm.yourrest.org/']),[],'another notification is left alone');

console.log(JSON.stringify({ok:true,checks}));
