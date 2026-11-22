// «خطة الغد»: the follow-ups of the plan, the late ones and their bulk move, «تغيير الموعد», and the day's targets (the owner, 2026-11-22: the
// port of GSCO 2.13.85; migration 0025), without a build. The pure rules (lib/daily-plan-followups.ts: the member's follow-ups, those due on
// the plan's day and the late ones, the search, 350 rows a page of 30 at a time, select all, parts of 200, one stop per customer, the
// targets read with Arabic digits, 0, 50 and 51, the words), the day-load picker of several follow-ups; then POST
// /api/crm/opportunity-next-dates on an isolated in-memory SQLite with every migration (the route compiled as the build does, the session
// faked, the clock held at chosen Riyadh times): 200 and 201 items, 30 and 31 days, a past day, Riyadh midnight, the request id replayed and
// reused with another body (409), each item's own answer (moved, unchanged, conflict, not_found, unassigned, closed, no_action), the reach
// (one's own follow-ups; a supervisor's team; read through «عرض بيانات الفريق بالكامل» only: not_found), a suspended owner, customer service
// and a switched-off cell (403), the audit lines kept out of GET /api/crm's changes; then POST /api/daily-plans with the targets: required to
// send, 0..50, Arabic digits, a plan of targets alone, a page older than the targets (409) and a send the device kept from before the update
// (accepted with the earlier rules), follow-ups only, the supervisor's change marked and kept from the member, a late change of the
// targets, the achieved numbers counted on the plan's Riyadh day (a customer added by hand at 23:59 and 00:00, an ERP or sheet import, an
// opportunity of a visit kept on the device), «ترحيل جماعي» in the plan and the list, and the Excel columns. Synthetic people and factories only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'daily-plan-followups-')),work=fs.mkdtempSync(path.join(os.tmpdir(),'yourrest-daily-plan-followups-')),seen=new Set();
process.on('exit',()=>{fs.rmSync(out,{recursive:true,force:true});fs.rmSync(work,{recursive:true,force:true});});
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};

// A clock the test holds: every `new Date()` and Date.now() of the modules reads it. The modules are loaded at Sunday 2026-11-22 08:00 Riyadh,
// after the release day, so the targets' rules apply from then (lib/daily-plans-server.ts planRulesSince).
const RealDate=Date;let held=RealDate.parse('2026-11-22T05:00:00Z');
class HeldDate extends RealDate{constructor(...args){if(args.length)super(...args);else super(held);}static now(){return held;}}
globalThis.Date=HeldDate;
const at=wall=>{held=RealDate.parse(wall.replace(' ','T')+':00+03:00');return new RealDate(held).toISOString();};

function compile(relative){if(seen.has(relative))return;seen.add(relative);const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';compile(source);return 'from '+JSON.stringify(path.join(out,source.replace(/\.tsx?$/,'.mjs')));});fs.writeFileSync(dest,code);}
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const u=globalThis.testUser;if(!u)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version FROM crm_members WHERE user_id=?').bind(u.userId).first();return {...u,provider:'email-otp',memberId:m?.id||'missing',memberVersion:m?.auth_version};}`);
for(const name of ['daily-plans','crm/opportunity-next-dates','crm'])compile('app/api/'+name+'/route.ts');
for(const name of ['lib/daily-plan-followups.ts','lib/daily-plans.ts','lib/followup-day-picker.ts','lib/list-export-plans.ts','lib/request-body.ts'])compile(name);
const load=name=>import(pathToFileURL(path.join(out,name)));
const F=await load('lib/daily-plan-followups.mjs'),R=await load('lib/daily-plans.mjs'),K=await load('lib/followup-day-picker.mjs'),X=await load('lib/list-export-plans.mjs'),B=await load('lib/request-body.mjs');

// ---- 1. The pure rules.
const T='2026-11-22',D='2026-11-23';// Sunday today; Monday the plan's day.
let n=0;
const customer=(id,assignedTo='rep1',extra={})=>({id,kind:'customer',parentId:null,assignedTo,branch:'الرئيسي',data:{name:'مصنع '+id,region:'الشرقية',city:'الدمام',internalCode:'YR-'+id,...extra},createdAt:'2026-11-01T00:00:00.000Z',updatedAt:'2026-11-01T00:00:00.000Z',version:1});
const contact=(id,customerId,data={},by='rep1')=>({id,kind:'activity',parentId:customerId,assignedTo:by,branch:'الرئيسي',data:{type:'call',date:'2026-11-10',summary:'متابعة',result:'تمت',performedBy:by,responsibleId:by,nextAction:'متابعة العرض',nextDate:'2026-11-20',visitWorkflow:'customer-v1',...data},createdAt:'2026-11-10T0'+(n++%10)+':00:00.000Z',updatedAt:'2026-11-10T00:00:00.000Z',version:3});
const pure=[customer('a'),contact('fa','a',{nextDate:'2026-11-12'}),customer('b'),contact('fb','b',{nextDate:'2026-11-20'}),customer('c'),contact('fc','c',{nextDate:T}),customer('d'),contact('fd','d',{nextDate:D}),
 customer('e'),contact('fe','e',{nextDate:'2026-11-25'}),customer('w'),contact('fw','w',{salesStage:'won',nextDate:'2026-11-12'}),customer('o','rep2'),contact('fo','o',{nextDate:'2026-11-12'},'rep2'),
 customer('l'),contact('fl','l',{salesStage:'lost',recontact:true,nextDate:'2026-11-15',nextAction:'إعادة التواصل'}),customer('q',undefined,{_offlineState:'pending'}),contact('fq','q',{nextDate:'2026-11-12'}),
 customer('x'),contact('fx','x',{nextDate:'2026-11-12',nextAction:''})];
const mine=F.memberFollowups(pure,'rep1',T);
eq(mine.map(item=>[item.customerId,item.id,item.nextDate,item.daysLate,item.version]),[['a','fa','2026-11-12',10,3],['l','fl','2026-11-15',7,3],['b','fb','2026-11-20',2,3],['c','fc',T,0,3],['d','fd',D,0,3],['e','fe','2026-11-25',0,3]],
 'the member\'s own open follow-ups, oldest first, each with its record and version: never another member\'s, a won one, one without a next action, nor a customer still on the device; a lost one with a re-contact date is followed');
eq(F.followupsDueOn(mine,D).map(item=>item.customerId),['d'],'due on the plan\'s day');
eq(F.overdueFollowups(mine,D,T).map(item=>item.customerId),['a','l','b','c'],'late for tomorrow\'s plan: before it and not after today (today\'s included: by the plan\'s day they are late)');
eq(F.overdueFollowups(mine,T,T).map(item=>item.customerId),['a','l','b'],'late for today\'s plan: before today only');
eq(F.overdueFollowups(mine,'2026-11-25',T).map(item=>item.customerId),['a','l','b','c'],'a plan after a day off: still not after today (tomorrow\'s are not late yet)');
eq([F.searchFollowups(mine,'مصنع a').map(item=>item.customerId),F.searchFollowups(mine,'yr-b').map(item=>item.customerId),F.searchFollowups(mine,'  ').length,F.searchFollowups(mine,'الدمام').length],[['a'],['b'],6,6],'the search: the name and the code, every word, case and spaces ignored');
eq(F.searchFollowups([{...mine[0],customerName:'مؤسسة الإنشاءات'}],'موسسه الانشاءات').length,1,'the search reads أ/إ/آ, ة and ى as the other searches');
eq([F.lateLabel(1,'ar'),F.lateLabel(2,'ar'),F.lateLabel(3,'ar'),F.lateLabel(11,'ar'),F.lateLabel(100,'ar'),F.lateLabel(103,'ar'),F.lateLabel(1,'en'),F.lateLabel(12,'en')],['متأخرة يومًا واحدًا','متأخرة يومين','متأخرة 3 أيام','متأخرة 11 يومًا','متأخرة 100 يوم','متأخرة 103 أيام','1 day late','12 days late'],'«متأخرة N يومًا» with Arabic number agreement, and in English');
// 350 late follow-ups: oldest first, a page of 30 at a time, «تحديد الكل» takes every result of the search, parts of 200.
const many=[];for(let i=0;i<350;i++){const id='m'+String(i).padStart(3,'0');many.push(customer(id),contact('f'+id,id,{nextDate:new RealDate(RealDate.parse('2026-10-01T12:00:00Z')+(i%40)*86400000).toISOString().slice(0,10)}));}
let started=performance.now();
const late=F.overdueFollowups(F.memberFollowups(many,'rep1',T),D,T);
const elapsed=performance.now()-started;
eq(late.length,350,'350 late follow-ups');
ok(late.every((item,index)=>index===0||late[index-1].nextDate<=item.nextDate),'oldest first');
ok(elapsed<1500,'listed in well under a second and a half ('+Math.round(elapsed)+' ms)');
eq([F.visibleFollowups(late,1).length,F.visibleFollowups(late,2).length,F.visibleFollowups(late,12).length,F.visibleFollowups(late,0).length],[30,60,350,30],'30 rows a page, «عرض المزيد» adds 30');
const searched=F.searchFollowups(late,'m00');
eq(searched.length,10,'a search narrows the list (m000 to m009)');
let selected=F.toggleAll(new Set(),searched);
eq(selected.size,10,'«تحديد كل نتائج البحث» selects every result, not only the rows on screen');
eq(F.toggleAll(selected,searched).size,0,'and clears them again');
selected=F.toggleAll(new Set(),late);
eq(selected.size,350,'«تحديد الكل» on 350');
eq(F.bulkParts([...selected]).map(part=>part.length),[200,150],'sent in parts of 200');
eq(F.bulkParts(Array.from({length:200})).length,1,'200 is one part');
eq(F.bulkParts(Array.from({length:201})).map(part=>part.length),[200,1],'201 is two');
eq([F.toggleOne(new Set(['a']),'a').size,F.toggleOne(new Set(),'a').has('a')],[0,true],'one row');
// One stop per customer, within the plan's room.
const chosen=[mine[0],mine[1],mine[2]];
eq([F.stopsNeeded(chosen,new Set(['a'])),F.stopsToAdd(chosen,new Set(['a']),5).map(item=>item.customerId),F.stopsToAdd(chosen,new Set(),1).map(item=>item.customerId)],[2,['l','b'],['a']],'a customer already in the plan takes no new stop; the room limits');
// The targets.
eq(['','٠','5','٥٠','۵۰',' 1 2 ','51','-1','1.5','abc',7].map(value=>F.readTarget(value)),[null,0,5,50,50,12,51,NaN,NaN,NaN,7],'a target typed: empty is not set; Arabic and Persian digits read; spaces dropped; anything else is not a number');
eq([0,50,51,-1,1.5,'3',null].map(F.planTargetValid),[true,true,false,false,false,false,false],'0 to 50, whole');
eq([F.parseTargets({opportunities:'٣',customers:0}),F.parseTargets({opportunities:null,customers:''}),F.parseTargets({opportunities:51,customers:0}),F.parseTargets({opportunities:1}),F.parseTargets({projects:1}),F.parseTargets('x')],
 [{opportunities:3,customers:0},{opportunities:null,customers:null},null,{opportunities:1,customers:null},null,null],'a request\'s targets: read, not set, out of range, a key of GSCO\'s, not an object');
eq([F.targetsProblem({opportunities:null,customers:0},true),F.targetsProblem({opportunities:null,customers:0},false),F.targetsProblem({opportunities:51,customers:0},false),F.targetsProblem({opportunities:0,customers:0},true)],[F.TARGET_MESSAGES.required,'',F.TARGET_MESSAGES.range,''],'required to send, a draft may keep one empty, the range always');
eq([F.hasTarget({opportunities:0,customers:0}),F.hasTarget({opportunities:0,customers:1}),F.hasTarget({opportunities:null,customers:null})],[false,true,false],'a plan of targets alone needs one above zero');
eq([F.targetLine(3,2,'ar'),F.targetLine(null,null,'ar'),F.targetLine(3,0,'en'),F.targetFigure(3,1),F.targetFigure(null,undefined)],['المستهدف 3 · المحقق 2','المستهدف لم يُحدَّد','Target 3 · Achieved 0','1/3','–'],'the target beside what was achieved');
eq([F.bulkMovesTitle(1,'ar'),F.bulkMovesTitle(2,'ar'),F.bulkMovesTitle(5,'ar'),F.bulkMovesTitle(12,'ar'),F.bulkMovesTitle(1,'en'),F.bulkMovesTitle(3,'en')],['ترحيل جماعي: متابعة واحدة','ترحيل جماعي: متابعتان','ترحيل جماعي: 5 متابعات','ترحيل جماعي: 12 متابعة','Bulk move: 1 follow-up','Bulk move: 3 follow-ups'],'«ترحيل جماعي: N متابعة»');
eq([F.dueButtonText(T,T)[0],F.dueButtonText(D,T)[0],F.dueButtonText('2026-11-25',T)[0],F.addToPlanText(D,T)[0],F.addToPlanText(T,T)[0]],['إضافة متابعات اليوم','إضافة متابعات الغد','إضافة متابعات يوم الخطة','إضافة إلى خطة الغد','إضافة إلى خطة اليوم'],'the buttons name the plan\'s day');
eq([F.bulkLastDay(T),F.bulkLastDay('2026-12-15')],['2026-12-22','2027-01-14'],'30 days ahead, across a year\'s end');
// The day load of several follow-ups moved together: their customers out of every day; a day they would make full is full.
const load5=[...Array.from({length:3},(_,i)=>[customer('k'+i),contact('fk'+i,'k'+i,{nextDate:'2026-11-24'})]).flat(),customer('m1'),contact('fm1','m1',{nextDate:'2026-11-24'}),customer('m2'),contact('fm2','m2',{nextDate:'2026-11-24'})];
const single=K.pickerView(load5,{ownerId:'rep1',today:T}).days.find(day=>day.date==='2026-11-24');
const moving=K.pickerView(load5,{ownerId:'rep1',today:T,moving:['m1','m2']}).days.find(day=>day.date==='2026-11-24');
eq([single.count,single.full,moving.count,moving.full],[5,false,3,false],'the two moved are out of their own day: 3 others; 3 + 2 is not more than 5');
const moving3=K.pickerView([...load5,customer('m3'),contact('fm3','m3',{nextDate:'2026-11-25'})],{ownerId:'rep1',today:T,moving:['m1','m2','m3']}).days.find(day=>day.date==='2026-11-24');
eq([moving3.count,moving3.full],[3,true],'3 others + 3 moved would be 6: full');
eq(B.jsonRequestLimit(new Request('https://x.invalid/api/crm/opportunity-next-dates')),64000,'the route\'s body limit');

// ---- 2. The routes on an isolated database.
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
const migrations=fs.readdirSync(path.join(root,'drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).sort();
eq(migrations.at(-1),'0025_daily_plan_targets.sql','the targets\' migration is the newest');
for(const name of migrations)sql.exec(fs.readFileSync(path.join(root,'drizzle',name),'utf8'));
class Statement{constructor(q,a=[]){this.q=q;this.a=a;}bind(...a){return new Statement(this.q,a);}async run(){const r=sql.prepare(this.q).run(...this.a);return{meta:{changes:Number(r.changes)}};}async all(){return{results:sql.prepare(this.q).all(...this.a)};}async first(){return sql.prepare(this.q).get(...this.a)||null;}}
const DB={prepare:q=>new Statement(q),batch:async statements=>{sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(/^\s*(SELECT|WITH)/i.test(s.q)?{...await s.all(),meta:{changes:0}}:await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid'};
const created=new RealDate(held).toISOString();
const member=(id,role,supervisor=null,region='eastern',active=1)=>sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,?,0,?)').run(id,'u-'+id,id+'@yourrest.org','اسم '+id,role,'الرئيسي',supervisor,region,active,created);
member('owner','admin',null,'all');member('mgr','manager',null,'all');member('sup','supervisor','mgr');member('sup2','supervisor','mgr');
member('rep1','rep','sup');member('rep2','rep','sup2');member('cs','customer_service','mgr');member('gone','rep','sup','eastern',0);member('rep3','rep','sup');
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-owner')").run();
const record=(id,kind,parent,assigned,data,when=created)=>sql.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').run(id,kind,parent,assigned,'الرئيسي',JSON.stringify(data),when,when);
const followup=(customerId,owner,data={},when='2026-11-10T07:00:00.000Z')=>{record('cust-'+customerId,'customer',null,owner,{name:'عميل '+customerId,region:'الشرقية',city:'الخبر',location:'26.3, 50.2'});record('fu-'+customerId,'activity','cust-'+customerId,owner,{type:'call',date:'2026-11-10',summary:'متابعة سابقة',result:'تمت',performedBy:owner,responsibleId:owner,nextAction:'متابعة العرض',nextDate:'2026-11-15',visitWorkflow:'customer-v1',...data},when);};
for(const id of ['1','2','3','4','5','6'])followup(id,'rep1');
followup('won','rep1',{salesStage:'won'});followup('lost','rep1',{salesStage:'lost'});followup('again','rep1',{salesStage:'lost',recontact:true,nextAction:'إعادة التواصل'});
followup('none','rep1',{nextAction:''});followup('other','rep2');followup('team3','rep3');followup('gone','gone');
const user=id=>{globalThis.testUser=id?{userId:'u-'+id,email:id+'@yourrest.org',fullName:id}:null;};
const nextDates=await load('app/api/crm/opportunity-next-dates/route.mjs'),plans=await load('app/api/daily-plans/route.mjs'),crm=await load('app/api/crm/route.mjs');
const call=async(handler,{as,body,url,origin='https://test.invalid'},status=200)=>{
 user(as);const request=body===undefined?new Request(url):new Request(url,{method:'POST',headers:{origin,'content-type':'application/json'},body:typeof body==='string'?body:JSON.stringify(body)});
 const response=await handler(request),data=await response.json();eq(response.status,status,(as||'anonymous')+' '+url+' '+JSON.stringify(body||'').slice(0,160)+' -> '+JSON.stringify(data).slice(0,300));return data;
};
const URL_ND='https://test.invalid/api/crm/opportunity-next-dates';
const move=(as,items,next,extra={},status)=>call(nextDates.POST,{as,url:URL_ND,body:{request_id:crypto.randomUUID(),next_date:next,items,...extra}},status);
const item=(customerId,version=1)=>({id:'fu-'+customerId,version});
const nextOf=customerId=>JSON.parse(sql.prepare('SELECT data FROM crm_records WHERE id=?').get('fu-'+customerId).data).nextDate;
const versionOf=customerId=>Number(sql.prepare('SELECT version FROM crm_records WHERE id=?').get('fu-'+customerId).version);
const statuses=answer=>answer.results.map(result=>[result.id.replace('fu-',''),result.status]);

at(T+' 08:00');
// Who: nobody, another site, customer service, a switched-off cell.
await call(nextDates.POST,{as:null,url:URL_ND,body:{}},401);
await call(nextDates.POST,{as:'rep1',url:URL_ND,body:{},origin:'https://evil.example'},403);
await move('cs',[item('1')],D,{},403);
sql.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_by,updated_at) VALUES('rep3','{\"plans:add\":false}','[]',2,'owner',?)").run(created);
ok((await move('rep3',[item('team3')],D,{},403)).error.includes('خطط المناديب'),'«إعداد خطة اليوم» switched off: 403, the screen named');
sql.prepare("DELETE FROM crm_member_permissions WHERE member_id='rep3'").run();
// The body: any other key (an offline time too), none or 201 items, the same item twice, a date not a day, a past day, 31 days.
await move('rep1',[item('1')],D,{offline:{memberId:'rep1',capturedAt:created}},400);
await move('rep1',[item('1')],D,{extra:1},400);
eq((await move('rep1',[],D,{},400)).error,F.BULK_MESSAGES.count,'no item');
eq((await move('rep1',Array.from({length:201},(_,i)=>({id:'x'+i,version:1})),D,{},400)).error,F.BULK_MESSAGES.count,'201 items are refused');
eq((await move('rep1',[item('1'),item('1')],D,{},400)).error,F.BULK_MESSAGES.duplicate,'the same follow-up twice');
await move('rep1',[item('1')],'2026-02-30',{},400);
eq((await move('rep1',[item('1')],'2026-11-21',{},400)).error,F.BULK_MESSAGES.past,'yesterday (Riyadh) is past');
eq((await move('rep1',[item('1')],'2026-12-23',{},400)).error,F.BULK_MESSAGES.far,'31 days ahead is refused');
eq(nextOf('1'),'2026-11-15','nothing moved');
// 200 items: each answered in the order sent (198 unknown ids, two real), and the loop gives way every 25.
let answer=await move('rep1',[item('1'),...Array.from({length:198},(_,i)=>({id:'nothing-'+i,version:1})),item('2')],'2026-12-22',{purpose:'reschedule'});
eq([answer.results.length,answer.moved,answer.failed,answer.results[0].status,answer.results[199].status,answer.results[100].status],[200,2,198,'moved','moved','not_found'],'200 items: one answer each, in order; 30 days ahead is allowed');
eq([nextOf('1'),nextOf('2'),versionOf('1')],['2026-12-22','2026-12-22',2],'moved, the version raised');
// Each item's own rules.
answer=await move('rep1',[item('3'),item('won'),item('lost'),item('again'),item('none'),item('other'),item('1',1),item('2',2),{id:'cust-4',version:1},item('gone')],D,{purpose:'plan',plan_date:D});
eq(statuses(answer),[['3','moved'],['won','closed'],['lost','closed'],['again','moved'],['none','no_action'],['other','not_found'],['1','conflict'],['2','moved'],['cust-4','not_found'],['gone','not_found']],
 'moved; won and lost closed; lost with a re-contact date moved; no next action; another member\'s or a customer or one out of reach not_found whether it exists or not; a stale version conflict');
eq(answer.results.find(result=>result.status==='conflict').message,F.NEXT_DATE_STATUS_TEXT.conflict,'each refusal says why');
eq(statuses(await move('rep1',[item('3',2)],D)),[['3','unchanged']],'the same date: unchanged');
// The request id: sent again with the same body answers from the receipts and moves nothing twice; with another body it is refused.
const requestId=crypto.randomUUID(),body={request_id:requestId,next_date:'2026-11-30',items:[item('5'),item('6')],purpose:'plan',plan_date:D};
answer=await call(nextDates.POST,{as:'rep1',url:URL_ND,body});
eq([statuses(answer),versionOf('5')],[[['5','moved'],['6','moved']],2],'moved once');
answer=await call(nextDates.POST,{as:'rep1',url:URL_ND,body});
eq([answer.results.map(result=>[result.status,result.replayed]),versionOf('5'),sql.prepare("SELECT COUNT(*) n FROM crm_audit WHERE record_id='fu-5' AND action=?").get(F.BULK_AUDIT_ACTION).n],[[['moved',true],['moved',true]],2,1],'the same request again: «moved» from its receipts, nothing written twice');
eq((await call(nextDates.POST,{as:'rep1',url:URL_ND,body:{...body,next_date:'2026-12-01'}},409)).error,F.BULK_MESSAGES.reused,'the same request id with another date: 409');
await call(nextDates.POST,{as:'rep1',url:URL_ND,body:{...body,items:[item('5',2)]}},409);
eq(nextOf('5'),'2026-11-30','and nothing moved');
// A supervisor: their team (an inactive owner: unassigned); another supervisor: not_found; one who reads the team through «عرض بيانات الفريق
// بالكامل» only: not_found; the administrator everyone.
eq(statuses(await move('sup',[item('team3'),item('gone')],D)),[['team3','moved'],['gone','unassigned']],'the supervisor moves his team\'s follow-up; the customer of a suspended representative is unassigned');
eq(statuses(await move('sup2',[item('team3',2)],'2026-11-26')),[['team3','not_found']],'another supervisor\'s team: not_found');
sql.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_by,updated_at) VALUES('sup2','{\"viewAll\":true}','[]',3,'owner',?)").run(created);
eq(statuses(await move('sup2',[item('team3',2)],'2026-11-26')),[['team3','not_found']],'read through «عرض بيانات الفريق بالكامل» only: not_found (that switch never writes in Yourrest)');
eq(statuses(await move('owner',[item('team3',2)],'2026-11-26')),[['team3','moved']],'the administrator');
// Riyadh midnight: at 23:59 today may be chosen; at 00:00 it is past.
at(T+' 23:59');
eq(statuses(await move('rep1',[item('4')],T)),[['4','moved']],'at 23:59 Riyadh, today');
at(D+' 00:00');
eq((await move('rep1',[item('4',2)],T,{},400)).error,F.BULK_MESSAGES.past,'at 00:00 the day before is past');
// The audit lines stay out of GET /api/crm's changes; the receipts never reach any list.
const snapshot=await call(crm.GET,{as:'owner',url:'https://test.invalid/api/crm'});
eq(snapshot.audits.filter(row=>row.action===F.BULK_AUDIT_ACTION||String(row.action).startsWith('followup-next-dates')).length,0,'no move in the changes list');
ok(sql.prepare('SELECT COUNT(*) n FROM crm_audit WHERE action=?').get(F.BULK_AUDIT_ACTION).n>=8,'every move has its audit line');
const line=sql.prepare("SELECT id,detail FROM crm_audit WHERE record_id='fu-3' AND action=? ORDER BY created_at LIMIT 1").get(F.BULK_AUDIT_ACTION);
ok(line.id.startsWith('followup-next-date:rep1:'+D+':')&&line.detail.startsWith('2026-11-15 → '+D+' • '),'the line names the member and the plan\'s day, and reads «old → new»');

// ---- 3. The plan with the targets.
at(T+' 08:00');
const planUrl='https://test.invalid/api/daily-plans';
const post=(as,data,status)=>call(plans.POST,{as,url:planUrl,body:{requestId:crypto.randomUUID(),...data}},status);
const stop=(customerId,kind='visit')=>({customerId:'cust-'+customerId,kind,time:'',note:''});
const get=(as,query,status)=>call(plans.GET,{as,url:planUrl+'?'+new URLSearchParams(query)},status);
const P='2026-11-24';// Tuesday: due at the midnight between Monday and Tuesday (since 2026-11-22).
// A page older than the targets (no `targets`) is refused; a send the device kept from before the update keeps the earlier rules.
eq((await post('rep1',{action:'send',date:P,stops:[stop('1')],baseVersion:null},409)).error,R.PLAN_MESSAGES.pageOutdated,'a page loaded before the update: «حُدّث التطبيق؛ أعد تحميل الصفحة.»');
eq((await post('rep1',{action:'save',date:P,stops:[stop('1')],baseVersion:null},409)).error,R.PLAN_MESSAGES.pageOutdated,'a draft of such a page too');
at(T+' 08:30');// the server started at 08:00 (05:00 UTC): a send kept on the device after that came from a page of this release
await post('rep1',{action:'send',date:P,stops:[stop('1')],baseVersion:null,offline:{memberId:'rep1',capturedAt:'2026-11-22T05:10:00.000Z'}},409);
record('free','customer',null,'rep1',{name:'عميل بلا متابعة',region:'الشرقية',city:'الخبر'});
let saved=await post('rep1',{action:'send',date:P,stops:[{customerId:'free',kind:'visit',time:'',note:''}],baseVersion:null,offline:{memberId:'rep1',capturedAt:'2026-11-22T04:30:00.000Z'}});
eq([saved.plan.state,saved.plan.stops.map(item=>item.customerId),saved.plan.targets],['sent',['free'],{opportunities:null,customers:null}],'kept on the device before the update: accepted with the earlier rules (a customer without a follow-up), no targets');
// The targets: required to send, 0..50, Arabic digits read; a plan of targets alone; follow-ups only.
const W='2026-11-25';
eq((await post('rep1',{action:'send',date:W,stops:[stop('2')],baseVersion:null,targets:{opportunities:null,customers:1}},400)).error,F.TARGET_MESSAGES.required,'a target not set: refused');
eq((await post('rep1',{action:'send',date:W,stops:[stop('2')],baseVersion:null,targets:{opportunities:51,customers:1}},400)).error,F.TARGET_MESSAGES.range,'51 refused');
await post('rep1',{action:'send',date:W,stops:[stop('2')],baseVersion:null,targets:{opportunities:-1,customers:1}},400);
await post('rep1',{action:'send',date:W,stops:[stop('2')],baseVersion:null,targets:{opportunities:0,customers:0,projects:1}},400);
eq((await post('rep1',{action:'send',date:W,stops:[],baseVersion:null,targets:{opportunities:0,customers:0}},400)).error,F.TARGET_MESSAGES.empty,'no follow-up and both targets zero: refused');
eq((await post('rep1',{action:'send',date:W,stops:[{customerId:'free',kind:'visit',time:'',note:''}],baseVersion:null,targets:{opportunities:0,customers:0}},400)).error,R.PLAN_MESSAGES.followupsOnly,'a customer without a follow-up is no longer added');
saved=await post('rep1',{action:'save',date:W,stops:[],baseVersion:null,targets:{opportunities:null,customers:'٣'}});
eq([saved.plan.state,saved.plan.targets],['draft',{opportunities:null,customers:3}],'a draft keeps a target not set yet; Arabic digits read');
saved=await post('rep1',{action:'send',date:W,stops:[],baseVersion:1,targets:{opportunities:'٥٠',customers:0}});
eq([saved.plan.state,saved.plan.stops.length,saved.plan.targets,saved.plan.targetsEdited],['sent',0,{opportunities:50,customers:0},false],'a plan of targets alone is sent (50 accepted)');
eq({...sql.prepare("SELECT target_opportunities,target_customers,targets_edited FROM crm_daily_plan_targets WHERE plan_id='daily-plan:rep1:'||?").get(W)},{target_opportunities:50,target_customers:0,targets_edited:0},'kept in crm_daily_plan_targets');
// The supervisor changes the targets: marked, the member's own kept; the member cannot change them; set back, the mark goes.
saved=await post('sup',{action:'approve_edited',memberId:'rep1',date:W,baseVersion:2,stops:[],targets:{opportunities:10,customers:2}});
eq([saved.plan.state,saved.plan.targets,saved.plan.targetsEdited,saved.plan.repTargets],['approved_edited',{opportunities:10,customers:2},true,{opportunities:50,customers:0}],'the supervisor\'s targets, marked, with the member\'s');
await post('sup',{action:'approve_edited',memberId:'rep1',date:W,baseVersion:3,stops:[],targets:{opportunities:10,customers:2}},400);
saved=await post('sup',{action:'return',memberId:'rep1',date:W,baseVersion:3,reason:'أضف متابعة'});
eq((await post('rep1',{action:'send',date:W,stops:[stop('2')],baseVersion:4,targets:{opportunities:50,customers:0}},403)).error,F.TARGET_MESSAGES.fixed,'the member cannot change what the supervisor set');
saved=await post('rep1',{action:'send',date:W,stops:[stop('2')],baseVersion:4,targets:{opportunities:10,customers:2}});
eq([saved.plan.state,saved.plan.targetsEdited],['sent',true],'sent with the supervisor\'s targets');
saved=await post('sup',{action:'approve_edited',memberId:'rep1',date:W,baseVersion:5,stops:saved.plan.stops.map(item=>({id:item.id,customerId:item.customerId,kind:item.kind,time:item.time,note:item.note})),targets:{opportunities:50,customers:0}});
eq([saved.plan.targets,saved.plan.targetsEdited,saved.plan.repTargets],[{opportunities:50,customers:0},false,null],'set back to the member\'s values: unmarked');
await post('sup',{action:'approve_edited',memberId:'rep1',date:W,baseVersion:6,stops:[...saved.plan.stops.map(item=>({id:item.id,customerId:item.customerId,kind:item.kind,time:item.time,note:item.note})),{customerId:'free',kind:'call',time:'',note:''}]},400);
// A change of the targets after the deadline makes a sent plan late; a re-send with the same targets does not.
const V='2026-11-26';
saved=await post('rep1',{action:'send',date:V,stops:[stop('2')],baseVersion:null,targets:{opportunities:1,customers:1}});
eq(saved.plan.late,false,'sent on time');
at('2026-11-26 00:30');// past the plan's midnight (GSCO 2.13.86; 22:00 the day before until 2026-11-22)
saved=await post('rep1',{action:'send',date:V,stops:[stop('2'),stop('6')].map((item,index)=>index===0?{...item,id:saved.plan.stops[0].id}:item),baseVersion:1,targets:{opportunities:1,customers:1}});
eq(saved.plan.late,false,'a stop changed after the deadline: still on time (the first send decides, Yourrest\'s rule)');
saved=await post('rep1',{action:'send',date:V,stops:saved.plan.stops.map(item=>({id:item.id,customerId:item.customerId,kind:item.kind,time:item.time,note:item.note})),baseVersion:2,targets:{opportunities:2,customers:1}});
eq(saved.plan.late,true,'the targets changed after the deadline: late (GSCO 2.13.85)');
eq((await get('sup',{date:V})).rows.find(row=>row.memberId==='rep1').late,true,'and the supervisor sees it late');

// ---- 4. The achieved numbers, counted on the plan's Riyadh day; «ترحيل جماعي».
at(D+' 09:00');
saved=await post('rep1',{action:'send',date:D,stops:[stop('3')],baseVersion:null,targets:{opportunities:2,customers:3}});
record('new-1','customer',null,'rep1',{name:'جديد 1',region:'الشرقية',_createdBy:'rep1'},'2026-11-23T20:59:00.000Z');// 23:59 Riyadh
record('new-2','customer',null,'rep1',{name:'جديد 2',region:'الشرقية',_createdBy:'rep1'},'2026-11-22T21:00:00.000Z');// 00:00 Riyadh, the plan's day
record('new-late','customer',null,'rep1',{name:'جديد بعد اليوم',region:'الشرقية',_createdBy:'rep1'},'2026-11-23T21:00:00.000Z');// 00:00 the next day
record('new-sheet','customer',null,'rep1',{name:'من ملف',region:'الشرقية',_createdBy:'rep1',sourceFile:'customers.xlsx'},'2026-11-23T08:00:00.000Z');
record('crm-rep1-erp-11111111-2222-4333-8444-555555555555-3','customer',null,'rep1',{name:'من ERP',region:'الشرقية',_createdBy:'rep1'},'2026-11-23T08:00:00.000Z');
record('new-other','customer',null,'rep2',{name:'لمندوب آخر',region:'الشرقية',_createdBy:'rep2'},'2026-11-23T08:00:00.000Z');
record('opp-1','opportunity','cust-1','rep1',{hasRequest:true,stage:'new',moldType:'ق',product:'ب',dimensions:'1',nextAction:'ع',nextDate:D,_createdBy:'rep1'},'2026-11-23T06:00:00.000Z');
record('opp-thread','opportunity','cust-1','rep1',{hasRequest:false,followupTitle:'متابعة',nextAction:'ع',nextDate:D,_createdBy:'rep1'},'2026-11-23T06:00:00.000Z');
let view=await get('rep1',{date:D});
eq([view.targets,view.actual],[{opportunities:2,customers:3},{opportunities:1,customers:2}],'the plan\'s day so far: one opportunity, two customers (00:00 and 23:59 Riyadh); never a sheet or ERP import, another member\'s, or the next day');
at('2026-11-24 09:00');
// A visit the device kept on the plan's day at 22:00 and sent the next morning, with its request of a mold.
record('customer-visit-k1','activity','cust-2','rep1',{type:'visit',date:'2026-11-23',summary:'زيارة',result:'تمت',performedBy:'rep1',nextAction:'ع',nextDate:'2026-11-27',offlineRecordedAt:'2026-11-23T19:00:00.000Z',requestId:'visit-request-k1'},'2026-11-24T06:00:00.000Z');
record('visit-request-k1','opportunity','cust-2','rep1',{hasRequest:true,stage:'new',moldType:'ق',product:'ب',dimensions:'1',nextAction:'ع',nextDate:'2026-11-27',_createdBy:'rep1'},'2026-11-24T06:00:00.000Z');
view=await get('sup',{date:D,memberId:'rep1'});
eq(view.actual,{opportunities:2,customers:2},'a visit kept on the device on the plan\'s day counts its request on that day, though it reached the server the next morning');
eq((await get('rep1',{date:'2026-11-27'})).actual,null,'no plan, no achieved numbers');
// «ترحيل جماعي»: the moves made from the plan of D.
eq(view.bulkMoves.map(item=>[item.customerId,item.from,item.to,item.purpose]).sort(),[['cust-3','2026-11-15',D,'plan'],['cust-5','2026-11-15','2026-11-30','plan'],['cust-6','2026-11-15','2026-11-30','plan'],['cust-again','2026-11-15',D,'plan'],['cust-2','2026-12-22',D,'plan']].sort(),'the supervisor reads each follow-up moved from this day\'s plan, old date → new');
eq(view.bulkMoves.every(item=>item.customerName.startsWith('عميل ')),true,'with the customer\'s name');
const list=await get('sup',{date:D});
eq([list.rows.find(row=>row.memberId==='rep1').bulkMoves,list.rows.find(row=>row.memberId==='rep1').targets],[5,{opportunities:2,customers:3}],'the list row: «ترحيل جماعي: 5» and the targets');
// The Excel columns.
const exported=await get('sup',{from:D,to:D});
const sheet=X.planTables(exported.plans.filter(item=>item.memberId==='rep1'),'ar')[0];
const column=name=>sheet.rows[0][sheet.header.indexOf(name)];
eq(['مستهدف فرص البيع الجديدة','فرص البيع الجديدة المحققة','مستهدف العملاء الجدد','العملاء الجدد المحققون','عدّل المشرف المستهدف','مستهدف المندوب قبل التعديل','ترحيل جماعي'].map(column),[2,2,3,2,'لا','',5],'«الخطط»: the targets, the achieved, the supervisor\'s change and the bulk moves');
const enHeader=X.planTables(exported.plans.filter(item=>item.memberId==='rep1'),'en')[0].header,fromTargets=enHeader.indexOf('Target: new sales opportunities');
eq(enHeader.slice(fromTargets,fromTargets+7),['Target: new sales opportunities','Achieved: new sales opportunities','Target: new customers','Achieved: new customers','Supervisor changed the targets','Representative\'s targets before the change','Bulk move'],'and in English');
eq(enHeader.slice(-3),['Sales manager changed the targets','Sales manager changed the plan','Sales manager\'s last change'],'then the sales manager\'s columns (2026-11-22, GSCO 2.13.86)');
const edited=X.planTables([{...exported.plans[0],targets:{opportunities:10,customers:2},targetsEdited:true,repTargets:{opportunities:50,customers:null}}],'ar')[0];
eq([edited.rows[0][edited.header.indexOf('عدّل المشرف المستهدف')],edited.rows[0][edited.header.indexOf('مستهدف المندوب قبل التعديل')]],['نعم','50 / –'],'a change of the supervisor\'s, with what the member had');
const older=X.planTables([{...exported.plans[0],targets:undefined,targetsEdited:undefined,repTargets:undefined,actual:undefined,bulkMoves:undefined}],'ar')[0];
eq(older.rows[0].slice(fromTargets,fromTargets+7),['','','','','لا','',0],'a plan from a server before the targets: empty cells');
eq(older.rows[0].slice(-3),['لا','لا',''],'and none of the sales manager\'s (a server before 2026-11-22 sends none)');
// A plan read from a server before the targets: none set.
eq(R.withTargets({...view,targets:undefined,targetsEdited:undefined,repTargets:undefined,actual:undefined,bulkMoves:undefined}).targets,{opportunities:null,customers:null},'withTargets reads an older server\'s plan as «لم يُحدَّد»');

console.log(JSON.stringify({ok:true,checks}));
