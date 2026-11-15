// «طلبات تعديل بيانات العميل» (the owner, 2026-11-15, item 4 of the GSCO comparison list: «تعديل بيانات العميل يستنى موافقة»;
// lib/customer-edit-requests*.ts, POST /api/crm {action:'customer-edit'}, GET /api/customer-edits). 1. The pure rules: who sends, who
// edits directly, where a request goes first and where it stands now (a supervisor deactivated or unlinked), the fields a request holds
// and never holds, the reason of a rejection (empty, invisible marks, one letter, Arabic digits, over 1000), a stale request. 2. The routes
// on an isolated in-memory SQLite (the real migrations): every role, the two steps, cancel at each step, the sales manager refused while it
// is with the supervisor, the ERP code and the routing locked, a repeated send, another edit while one waits, a field changed since
// (stale), another field changed since (both kept), the approval and its end in one transaction, regions, the «تعديل» cell, an offline
// edit refused, a deleted customer, the history's words. Synthetic people and customers only; no build, no network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'customer-edit-requests-')),seen=new Set();
process.on('exit',()=>{fs.rmSync(out,{recursive:true,force:true});});
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const u=globalThis.testUser;if(!u)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version FROM crm_members WHERE user_id=?').bind(u.userId).first();return {...u,provider:'email-otp',memberId:m?.id||'missing',memberVersion:m?.auth_version};}`);
function compile(relative){if(seen.has(relative))return;seen.add(relative);const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));if(/\.json$/.test(source)){const target=path.join(out,source);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,source),target);return 'from '+JSON.stringify(target)+' with {type:"json"}';}if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';compile(source);return 'from '+JSON.stringify(path.join(out,source.replace(/\.tsx?$/,'.mjs')));});fs.writeFileSync(dest,code);}
for(const name of ['crm','customer-edits'])compile('app/api/'+name+'/route.ts');
const rules=await import(pathToFileURL(path.join(out,'lib/customer-edit-requests.mjs')));

// ---- 1. The pure rules.
eq(['admin','manager','supervisor','rep','customer_service','customer_service_manager'].map(rules.directCustomerEditRole),[true,true,false,false,false,false],'the administrator and the sales manager edit directly');
eq(['admin','manager','supervisor','rep','customer_service','customer_service_manager'].map(rules.proposesCustomerEdit),[false,false,true,true,true,true],'a representative, a supervisor and customer service (and its manager) send a request');
const people=[
 {id:'rep',role:'rep',active:1,supervisorId:'sup'},{id:'sup',role:'supervisor',active:1,supervisorId:'mgr'},{id:'mgr',role:'manager',active:1},
 {id:'lone',role:'rep',active:1},{id:'toManager',role:'rep',active:1,supervisorId:'mgr'},{id:'toAdmin',role:'rep',active:1,supervisorId:'admin'},
 {id:'admin',role:'admin',active:1},{id:'toGone',role:'rep',active:1,supervisorId:'gone'},{id:'gone',role:'supervisor',active:0},
 {id:'toMissing',role:'rep',active:1,supervisorId:'nobody'},{id:'cs',role:'customer_service',active:1,supervisorId:'csm'},{id:'csm',role:'customer_service_manager',active:1,supervisorId:'mgr'},
 {id:'sup2',role:'supervisor',active:1,supervisorId:'sup'}
];
eq(['rep','sup','lone','toManager','toAdmin','toGone','toMissing','cs','csm','sup2'].map(id=>rules.firstStage(id,people)),['supervisor','sales_manager','sales_manager','sales_manager','sales_manager','sales_manager','sales_manager','sales_manager','sales_manager','sales_manager'],'first: a representative with an active supervisor to the supervisor; no supervisor, one who is a sales manager or the administrator, an inactive or missing one, a supervisor, customer service: the sales manager');
eq(rules.activeSupervisorOf('rep',people)?.id,'sup','the supervisor from the account\'s link');
eq(rules.liveStage({stage:'supervisor',requestedBy:'rep'},false,people),'supervisor','waits with the supervisor');
eq(rules.liveStage({stage:'supervisor',requestedBy:'rep'},true,people),'sales_manager','once the supervisor approved: the sales manager');
eq(rules.liveStage({stage:'supervisor',requestedBy:'rep'},false,people.map(p=>p.id==='sup'?{...p,active:0}:p)),'sales_manager','the supervisor deactivated while it waits: the sales manager, read live');
eq(rules.liveStage({stage:'supervisor',requestedBy:'rep'},false,people.map(p=>p.id==='rep'?{...p,supervisorId:null}:p)),'sales_manager','the representative unlinked: the sales manager');
eq(rules.liveStage({stage:'supervisor',requestedBy:'rep'},false,people.map(p=>p.id==='rep'?{...p,role:'supervisor'}:p)),'sales_manager','the sender is no longer a representative: the sales manager');
eq(rules.liveStage({stage:'supervisor',requestedBy:'rep'},false,people.map(p=>p.id==='rep'?{...p,supervisorId:'sup2'}:p)),'supervisor','linked to another active supervisor: that supervisor');
eq(rules.liveStage({stage:'sales_manager',requestedBy:'rep'},false,people),'sales_manager','sent to the sales manager: stays there even if a supervisor is linked later');
// What a request holds.
const stored={name:'مصنع الأمل',region:'الشرقية',code:'C-100',phone:'0501111111',city:'الدمام',location:'26.43, 50.03',latitude:26.43,longitude:50.03,locationSource:'device',locationCapturedAt:'2026-11-01T08:00:00.000Z',locationAccuracy:8,machineCount:3,notes:'',assignedTo:'rep',branch:'الرئيسي'};
let proposal=rules.customerEditProposal(stored,{...stored,phone:'0502222222',code:'C-999',assignedTo:'other',branch:'آخر',sourceFile:'x'});
eq([proposal.fields,proposal.values,proposal.base],[['phone'],{phone:'0502222222'},{phone:'0501111111'}],'only the changed allowed field; the ERP code, the routing and the import markers never enter a request');
eq(rules.CUSTOMER_EDIT_FIELDS.some(field=>rules.CUSTOMER_EDIT_LOCKED.includes(field)),false,'no locked field is a request field');
proposal=rules.customerEditProposal(stored,{...stored,location:'26.5, 50.1',latitude:26.5,longitude:50.1,locationSource:undefined,locationCapturedAt:undefined,locationAccuracy:undefined});
eq([proposal.fields,proposal.values],[['location'],{location:'26.5, 50.1',latitude:26.5,longitude:50.1,locationSource:null,locationCapturedAt:null,locationAccuracy:null}],'a new place carries its point, and the old capture is dropped');
const relocated={...stored,location:'26.5, 50.1',latitude:26.5,longitude:50.1};delete relocated.locationSource;delete relocated.locationCapturedAt;delete relocated.locationAccuracy;
eq(rules.applyCustomerEdit(stored,{fields:proposal.fields,values:proposal.values}),relocated,'applied: the new point without the old capture');
eq(rules.applyCustomerEdit(stored,{fields:['phone','code','assignedTo'],values:{phone:'1',code:'X',assignedTo:'Y'}}),{...stored,phone:'1'},'applying never touches a field outside the list, even a forged one');
eq(rules.customerEditProposal(stored,{...stored,machineCount:3,notes:undefined}).fields,[],'a number as stored and an empty note left out are no change');
eq(rules.customerEditProposal(stored,{...stored,machineCount:null}).fields,['machineCount'],'a count cleared is a change');
eq(rules.customerEditProposal({name:'أ'},{name:'أ',region:''}).fields,[],'an empty value where nothing was stored is no change');
eq(rules.staleFields({base:{phone:'0501111111'}},stored),[],'nothing moved: not stale');
eq(rules.staleFields({base:{phone:'0501111111'}},{...stored,phone:'0509999999'}),['phone'],'the same field changed since: stale');
eq(rules.staleFields({base:{phone:'0501111111'}},{...stored,city:'الخبر'}),[],'another field changed since: not stale');
eq(rules.customerEditChanges({fields:['phone'],values:{phone:'0502222222'},base:{phone:'0501111111'}},{phone:'0503333333'}),[{field:'phone',before:'0503333333',after:'0502222222'}],'while it waits: what it would overwrite now');
eq(rules.customerEditChanges({fields:['phone'],values:{phone:'0502222222'},base:{phone:'0501111111'}},null),[{field:'phone',before:'0501111111',after:'0502222222'}],'once decided: what it held when sent');
eq(rules.customerEditFingerprint('c',['b','a'],{b:1,a:2}),rules.customerEditFingerprint('c',['a','b'],{a:2,b:1}),'the fingerprint ignores order');
// The reason of a rejection.
for(const [value,label] of [['','empty'],['   ','spaces'],['‏‎​','invisible marks'],['‫س‬','one letter inside direction marks'],['x','one letter'],[undefined,'missing'],[42,'a number']])eq(rules.rejectReason(value),{ok:false,error:'اكتب سبب الرفض (حرفان على الأقل).'},'a reason is refused: '+label);
eq(rules.rejectReason('س'.repeat(1001)),{ok:false,error:'سبب الرفض طويل؛ الحد الأقصى 1000 حرف.'},'over 1000: refused');
eq(rules.rejectReason('  '+'س'.repeat(1000)+'  '),{ok:true,note:'س'.repeat(1000)},'1000 after trimming: kept');
eq(rules.rejectReason(' رقم الجوال ٠٥٠١٢٣ غير صحيح '),{ok:true,note:'رقم الجوال ٠٥٠١٢٣ غير صحيح'},'Arabic digits kept as written');
eq(rules.rejectReason('لا'),{ok:true,note:'لا'},'two letters are a reason');
eq(rules.customerEditStatusText({status:'pending',stage:'supervisor'})[0],'بانتظار موافقة المشرف','the words of a step');
eq(rules.sentText('supervisor')[0],'تم إرسال التعديل إلى مشرفك للموافقة','the toast: to the supervisor');
eq(rules.sentText('sales_manager')[0],'تم إرسال التعديل إلى مدير المبيعات للموافقة','the toast: to the sales manager');

// ---- 2. The routes on a real SQLite with the real migrations.
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+f,'utf8'));
let race=null;
class Statement{constructor(q,a=[]){this.q=q;this.a=a;}bind(...a){return new Statement(this.q,a);}async run(){const r=sql.prepare(this.q).run(...this.a);return{meta:{changes:Number(r.changes)}};}async all(){return{results:sql.prepare(this.q).all(...this.a)};}async first(){return sql.prepare(this.q).get(...this.a)||null;}}
// Transactions one after another, as the database serialises them (two requests at once interleave only between statements of JavaScript).
let queue=Promise.resolve();
const DB={prepare:q=>new Statement(q),batch:statements=>{const run=queue.then(async()=>{if(race){const fn=race;race=null;await fn();}sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}});queue=run.catch(()=>{});return run;}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid'};
const now=new Date().toISOString();
const member=(id,role,sup=null,region='eastern',branch='الرئيسي')=>sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,1,0,?)').run(id,'u-'+id,id+'@yourrest.org','اسم '+id,role,branch,sup,region,now);
member('owner','admin',null,'all');member('mgr','manager',null,'all');member('mgr-west','manager',null,'western');
member('sup','supervisor','mgr');member('sup2','supervisor','mgr');
member('rep','rep','sup');member('rep2','rep','sup2');member('lone','rep');member('rep-mgr','rep','mgr');
member('cs','customer_service','csm');member('csm','customer_service_manager','mgr');
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-owner')").run();
const user=id=>{globalThis.testUser=id?{userId:'u-'+id,email:id+'@yourrest.org',fullName:id}:null;};
const crm=await import(pathToFileURL(path.join(out,'app/api/crm/route.mjs'))),edits=await import(pathToFileURL(path.join(out,'app/api/customer-edits/route.mjs')));
const raw=id=>sql.prepare('SELECT * FROM crm_records WHERE id=?').get(id),row=id=>({...raw(id),data:JSON.parse(raw(id).data)});
const customer=(id,assignedTo,extra={},region='الشرقية')=>{const data={name:'مصنع '+id,region,assignedTo,branch:'الرئيسي',location:'26.437341, 50.034499',phone:'0500000000',city:'الدمام',code:'ERP-'+id,...extra};sql.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,'customer',NULL,?,'الرئيسي',?,?,?,1)").run(id,assignedTo,JSON.stringify(data),now,now);};
customer('c1','rep');customer('c2','rep2');customer('c3','sup');customer('c4','lone');customer('west1','rep',{},'الغربية');
const request=(body,origin='https://test.invalid')=>new Request('https://test.invalid/api/crm',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
const post=async(who,body,status=200)=>{user(who);const res=await crm.POST(request(body)),data=await res.json();eq(res.status,status,who+' '+JSON.stringify(body).slice(0,120)+' -> '+JSON.stringify(data));return data;};
const list=async(who,customerId,status=200)=>{user(who);const res=await edits.GET(new Request('https://test.invalid/api/customer-edits'+(customerId?'?customerId='+encodeURIComponent(customerId):''))),data=await res.json();eq(res.status,status,'list of '+who+' -> '+JSON.stringify(data).slice(0,200));if(status===200)eq(res.headers.get('cache-control'),'no-store','never cached');return data;};
const edit=(id,extra={},editKey=crypto.randomUUID())=>{const value=row(id);return {action:'save',kind:'customer',id,version:value.version,editKey,data:{...value.data,assignedTo:value.assigned_to,branch:value.branch,...extra}};};
const decide=(who,decision,id,status=200,note)=>post(who,{action:'customer-edit',decision,id,...(note===undefined?{}:{note})},status);
const pendingOf=id=>sql.prepare("SELECT q.id,q.detail FROM crm_audit q WHERE q.record_id=? AND q.action='customer-edit:request' AND NOT EXISTS (SELECT 1 FROM crm_audit d WHERE d.id='customer-edit-decision:'||q.id)").all(id).map(r=>({id:r.id,...JSON.parse(r.detail)}));
const audits=(id,action)=>sql.prepare('SELECT action,actor,detail FROM crm_audit WHERE record_id=? AND action=? ORDER BY created_at,rowid').all(id,action);
const snapshot=id=>JSON.stringify(raw(id));

// The administrator and the sales manager edit directly.
await post('owner',edit('c1',{notes:'by the administrator'}));eq(row('c1').data.notes,'by the administrator','the administrator edits directly');
await post('mgr',edit('c1',{notes:'by the sales manager'}));eq(row('c1').data.notes,'by the sales manager','the sales manager edits directly');
eq(pendingOf('c1').length,0,'neither makes a request');

// A representative with an active supervisor: the supervisor first, then the sales manager.
let before=snapshot('c1');
let sent=await post('rep',edit('c1',{phone:'0507777777',city:'الخبر'}));
eq([sent.ok,sent.id,sent.pendingApproval,sent.approvalStage],[true,'c1',true,'supervisor'],'the answer says where it waits');
eq(snapshot('c1'),before,'the customer does not change');
let waiting=pendingOf('c1');eq(waiting.length,1,'one request waits');
eq([waiting[0].requestedBy,waiting[0].stage,waiting[0].fields.sort(),waiting[0].values,waiting[0].base],['rep','supervisor',['city','phone'],{phone:'0507777777',city:'الخبر'},{phone:'0500000000',city:'الدمام'}],'it holds only what changed and what it held');
let rid=waiting[0].id;
eq(audits('c1','customer-edit:request').length,1,'the request is audited');
eq((await list('mgr')).requests.some(r=>r.id===rid),false,'not in the sales manager\'s list yet');
let onPage=(await list('mgr','c1')).requests.find(r=>r.id===rid);
eq([onPage.stage,onPage.canDecide,onPage.changes.map(c=>[c.field,c.before,c.after])],['supervisor',false,[['phone','0500000000','0507777777'],['city','الدمام','الخبر']]],'the customer\'s page shows it with the supervisor, before and after, and the sales manager cannot decide');
eq((await decide('mgr','approve',rid,403)).error,'الطلب عند مشرف المندوب. يصل إلى مدير المبيعات بعد موافقة المشرف.','the sales manager is refused while it is with the supervisor');
await decide('mgr','reject',rid,403,'سبب');await decide('owner','approve',rid,403);
eq((await decide('sup2','approve',rid,403)).error,'الموافقة على هذا الطلب متاحة لمشرف المندوب.','another supervisor is refused');
eq((await list('sup2')).requests.length,0,'and sees nothing');eq((await list('rep2')).requests.length,0,'another representative sees nothing');
eq((await list('rep2','c1')).requests.length,0,'nor on the customer');
await decide('rep','approve',rid,403);await decide('cs','approve',rid,403);
let atSup=(await list('sup')).requests.find(r=>r.id===rid);
eq([atSup.stage,atSup.canDecide,atSup.requestedByName,atSup.customerName],['supervisor',true,'اسم rep','مصنع c1'],'the representative\'s supervisor sees it and may decide');
eq((await list('sup')).waiting,1,'the count of what waits for them');
let mine=(await list('rep')).requests.find(r=>r.id===rid);eq([mine.stage,mine.mine,mine.canCancel,mine.canDecide],['supervisor',true,true,false],'the sender sees where it waits and may cancel');
eq((await decide('sup','approve',rid)).stage,'sales_manager','the supervisor passes it on');
eq(snapshot('c1'),before,'the customer still waits for the sales manager');
eq(audits('c1','customer-edit:supervisor-approved').length,1,'the supervisor\'s approval is audited');
await decide('sup','approve',rid,403);await decide('sup','reject',rid,403,'متأخر');
eq((await list('sup')).requests.some(r=>r.id===rid),false,'it leaves the supervisor\'s list');
let atMgr=(await list('mgr')).requests.find(r=>r.id===rid);
eq([atMgr.stage,atMgr.canDecide,atMgr.supervisorName],['sales_manager',true,'اسم sup'],'the sales manager sees it with who approved it');
eq((await list('rep')).requests.find(r=>r.id===rid).supervisorName,'اسم sup','and so does the sender');
eq((await list('mgr-west')).requests.some(r=>r.id===rid),false,'a sales manager of another region does not see it');
eq((await decide('mgr-west','approve',rid,403)).error,'السجل خارج نطاق صلاحيتك','and cannot decide it');
const version=row('c1').version;
eq((await decide('mgr','approve',rid)).status,'approved','approved');
eq([row('c1').data.phone,row('c1').data.city,row('c1').data.name,row('c1').data.code,row('c1').version],['0507777777','الخبر','مصنع c1','ERP-c1',version+1],'the values apply once, untouched fields and the ERP code stay');
eq([row('c1').assigned_to,row('c1').branch],['rep','الرئيسي'],'the routing stays');
await decide('mgr','approve',rid,409);await decide('rep','cancel',rid,409);
eq(row('c1').version,version+1,'a second approval changes nothing');
eq(audits('c1','customer-edit:approved').map(a=>[a.actor,JSON.parse(a.detail).requestedBy,JSON.parse(a.detail).by]),[['اسم mgr','rep','mgr']],'the approval is audited with who decided and who sent it');
ok(audits('c1','تعديل').some(a=>a.actor==='اسم mgr'),'and the ordinary «تعديل» entry of the save');
mine=(await list('rep')).requests.find(r=>r.id===rid);eq([mine.status,mine.decidedByName,mine.changes.map(c=>[c.before,c.after])],['approved','اسم mgr',[['0500000000','0507777777'],['الدمام','الخبر']]],'the sender reads the answer, with what it held when sent');
// The history reads words, never the fields.
user('mgr');const history=(await (await crm.GET()).json()).audits.filter(a=>a.recordId==='c1').map(a=>a.action);
for(const words of ['طلب تعديل بيانات العميل','موافقة المشرف على تعديل بيانات العميل','الموافقة على تعديل بيانات العميل'])ok(history.includes(words),'the history names: '+words);
ok(!history.some(a=>a.startsWith('customer-edit:')),'no machine word in the history');
ok((await (await crm.GET()).json()).audits.filter(a=>a.recordId==='c1'&&a.action.includes('تعديل بيانات العميل')).every(a=>a.detail==='مصنع c1'),'the history\'s detail is the customer\'s name');

// The supervisor's rejection ends it with the reason; the sales manager never gets it.
before=snapshot('c1');
rid=(await post('rep',edit('c1',{notes:'ملاحظة جديدة'}))).requestId;
for(const note of ['',' ','‏‎','x','س'.repeat(1001)])await decide('sup','reject',rid,400,note);
await decide('sup','reject',rid,400);
eq((await decide('sup','reject',rid,200,'  البيانات غير صحيحة ٣  ')).status,'rejected','the supervisor rejects with a reason');
eq(snapshot('c1'),before,'rejected: nothing changes');
mine=(await list('rep')).requests.find(r=>r.id===rid);eq([mine.status,mine.note,mine.decidedByName,mine.canCancel],['rejected','البيانات غير صحيحة ٣','اسم sup',false],'the sender reads the reason and who rejected it');
eq((await list('mgr')).requests.some(r=>r.id===rid),false,'the sales manager has nothing to decide');
eq(JSON.parse(audits('c1','customer-edit:rejected')[0].detail).stage,'supervisor','the rejection is audited at its step');

// The sales manager's rejection.
rid=(await post('rep',edit('c1',{notes:'محاولة ثانية'}))).requestId;await decide('sup','approve',rid);
await decide('mgr','reject',rid,400,' ');
eq((await decide('mgr','reject',rid,200,'لا يلزم')).status,'rejected','the sales manager rejects');
eq([(await list('rep')).requests.find(r=>r.id===rid).note,row('c1').data.notes],['لا يلزم','by the sales manager'],'the reason reaches the sender; nothing changes');

// The sender cancels at either step; nobody else can.
rid=(await post('rep',edit('c1',{notes:'cancel early'}))).requestId;
await decide('sup','cancel',rid,403);await decide('mgr','cancel',rid,403);await decide('rep2','cancel',rid,403);
eq((await decide('rep','cancel',rid)).status,'cancelled','cancelled with the supervisor');
rid=(await post('rep',edit('c1',{notes:'cancel late'}))).requestId;await decide('sup','approve',rid);
eq((await decide('rep','cancel',rid)).status,'cancelled','cancelled after the supervisor');
await decide('mgr','approve',rid,409);eq(row('c1').data.notes,'by the sales manager','a cancelled request never applies');
eq(audits('c1','customer-edit:cancelled').length,2,'each cancel is audited');

// Straight to the sales manager: no supervisor, a supervisor who is the sales manager, a supervisor's own, customer service and its manager.
for(const [who,id] of [['lone','c4'],['rep-mgr','c4'],['sup','c3'],['cs','c1'],['csm','c1']]){
 before=snapshot(id);const answer=await post(who,edit(id,{notes:'من '+who}));
 eq([answer.pendingApproval,answer.approvalStage],[true,'sales_manager'],who+': straight to the sales manager');eq(snapshot(id),before,who+': the customer waits');
 const seen=(await list('mgr')).requests.find(r=>r.id===answer.requestId);eq([seen.stage,seen.canDecide],['sales_manager',true],who+': the sales manager may decide at once');
 await decide(who,'cancel',answer.requestId);
}
rid=(await post('csm',edit('c1',{contact2:'مسؤول جديد'}))).requestId;await decide('owner','approve',rid);
eq(row('c1').data.contact2,'مسؤول جديد','the administrator approves too');

// A supervisor deactivated or unlinked while it waits: it reaches the sales manager, read live.
rid=(await post('rep',edit('c1',{supplier:'مورد أ'}))).requestId;
sql.prepare("UPDATE crm_members SET active=0 WHERE id='sup'").run();
let moved=(await list('mgr')).requests.find(r=>r.id===rid);eq([moved.stage,moved.canDecide],['sales_manager',true],'the supervisor left: the sales manager may decide');
eq((await list('rep')).requests.find(r=>r.id===rid).stage,'sales_manager','the sender sees it moved on');
sql.prepare("UPDATE crm_members SET active=1 WHERE id='sup'").run();
eq((await list('mgr')).requests.some(r=>r.id===rid),false,'the supervisor back: it is with them again (nothing was moved)');
sql.prepare("UPDATE crm_members SET supervisor_id='mgr' WHERE id='rep'").run();
await decide('mgr','approve',rid);eq(row('c1').data.supplier,'مورد أ','unlinked: the sales manager approves it');
sql.prepare("UPDATE crm_members SET supervisor_id='sup' WHERE id='rep'").run();
// A deactivation between reading and committing: the supervisor's step refuses.
rid=(await post('rep',edit('c1',{supplier:'مورد ب'}))).requestId;
const originalPrepare=DB.prepare;let armed=true;DB.prepare=q=>{if(armed&&q.startsWith('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT')&&q.includes('ce_mine')){armed=false;sql.prepare("UPDATE crm_members SET supervisor_id=NULL WHERE id='rep'").run();}return originalPrepare(q);};
await decide('sup','approve',rid,409);DB.prepare=originalPrepare;sql.prepare("UPDATE crm_members SET supervisor_id='sup' WHERE id='rep'").run();
eq(sql.prepare("SELECT COUNT(*) n FROM crm_audit WHERE id=?").get('customer-edit-supervisor:'+rid).n,0,'the commit re-checks the link');
await decide('rep','cancel',rid);

// Locked fields: the ERP code and the routing are refused; nothing waits.
before=snapshot('c1');
eq((await post('rep',edit('c1',{code:'ERP-OTHER'}),403)).error,'كود ERP لا يُكتب ولا يُعدَّل يدويًا لأي مستخدم، ولا لمدير النظام؛ يُحدَّث من ملف عملاء ERP فقط («استيراد من ERP»).','the ERP code: 403');
await post('rep',edit('c1',{code:''}),403);await post('sup',edit('c3',{code:'X'}),403);await post('cs',edit('c1',{code:'X'}),403);
eq((await post('rep',edit('c1',{assignedTo:'rep2'}),403)).error,'لا يمكنك تغيير مسؤول العميل أو فرعه','the responsible member: 403');
await post('cs',edit('c1',{branch:'آخر'}),403);
eq([snapshot('c1'),pendingOf('c1').length],[before,0],'none of these becomes a request');
// A forged field beside a real change never enters the request.
rid=(await post('rep',edit('c1',{notes:'مع حقول مزورة',sourceFile:'forged.xlsx',erpRep:'forged',_masterReadOnly:false,internalCode:'YR-X'}))).requestId;
eq(Object.keys(pendingOf('c1')[0].values),['notes'],'only the note is held');
await decide('sup','approve',rid);await decide('mgr','approve',rid);
eq([row('c1').data.notes,row('c1').data.sourceFile,row('c1').data.erpRep,row('c1').data.code],['مع حقول مزورة',undefined,undefined,'ERP-c1'],'and only the note applies');
// What a direct edit refuses is refused on sending.
await post('rep',edit('c1',{name:''}),400);await post('rep',edit('c1',{notes:'x'.repeat(6001)}),400);await post('rep',edit('c1',{name:'س'.repeat(251)}),400);
await post('rep',edit('c1',{location:'not a place'}),400);await post('rep',edit('c1',{email:'not-an-email'}),400);
await post('rep',edit('c1',{location:'51.5, -0.12'}),400);
eq((await post('rep',edit('c1',{}),400)).error,'لم يتغير شيء في بيانات العميل.','nothing changed: 400');
await post('rep',{...edit('c1',{notes:'old form'}),version:row('c1').version-1},409);
await post('rep',edit('west1',{notes:'x'}),404);
eq(pendingOf('c1').length+pendingOf('west1').length,0,'none of these becomes a request');
// Long text and Arabic digits keep as written through the request and the approval.
rid=(await post('rep',edit('c1',{notes:'٣ ماكينات‏ '+'ن'.repeat(5900),phone:'٠٥٠١٢٣٤٥٦٧'}))).requestId;await decide('sup','approve',rid);await decide('mgr','approve',rid);
eq([row('c1').data.notes,row('c1').data.phone],['٣ ماكينات‏ '+'ن'.repeat(5900),'٠٥٠١٢٣٤٥٦٧'],'Arabic digits, marks and a long note keep as written');

// A repeated send makes no second request; another edit while one waits is refused, whoever sends it.
const key=crypto.randomUUID(),body=edit('c1',{city:'الجبيل'},key);
const first=await post('rep',body),again=await post('rep',body);
eq([again.alreadySaved,again.requestId,pendingOf('c1').length],[true,first.requestId,1],'the same send again: the same request');
const noKey=edit('c1',{city:'الجبيل'});delete noKey.editKey;
eq([(await post('rep',noKey)).alreadySaved,pendingOf('c1').length],[true,1],'the same edit without its key (an older page): still one');
eq((await post('rep',edit('c1',{city:'القطيف'}),409)).error,'لديك طلب تعديل بانتظار الموافقة على هذا العميل. ألغِه من بيانات العميل ثم أرسل التعديل الجديد.','another edit of the sender: 409');
eq((await post('rep2',edit('c1',{city:'القطيف'}),409)).error,'يوجد طلب تعديل آخر على هذا العميل بانتظار الموافقة.','another member: 409');
eq(pendingOf('c1')[0].values.city,'الجبيل','what was read stays what is approved');
await decide('rep','cancel',first.requestId);
const late=await post('rep',{...body,version:row('c1').version});
eq([late.alreadySaved,late.pendingApproval,late.requestStatus,pendingOf('c1').length],[true,false,'cancelled',0],'the same send after it was cancelled: told so, nothing new waits');
eq((await post('rep',{...edit('c1',{city:'القطيف'}),editKey:key},409)).error,'تم إرسال هذا الطلب من قبل. أعد فتح بيانات العميل ثم أرسل التعديل الجديد.','a used key with another content: 409');
// Two sends at once commit one request.
const both2=await Promise.all([['rep','ينبع'],['rep2','رابغ']].map(async([who,city])=>{user(who);const response=await crm.POST(request(edit('c1',{city})));return [response.status,await response.json()];}));
eq([both2.map(([status])=>status).sort(),pendingOf('c1').length],[[200,409],1],'two at once: one waits, the other is told');
await decide(pendingOf('c1')[0].requestedBy,'cancel',pendingOf('c1')[0].id);

// Stale: the same field changed since is refused at either step; another field changed since keeps both.
rid=(await post('rep',edit('c1',{phone:'0511111111'}))).requestId;
await post('mgr',edit('c1',{phone:'0522222222'}));
eq((await list('sup')).requests.find(r=>r.id===rid).stale,true,'the supervisor sees it is out of date');
eq((await decide('sup','approve',rid,409)).error,'تغيرت البيانات نفسها بعد إرسال الطلب. ارفض الطلب ليعيد صاحبه إرساله على البيانات الحالية.','not passed on');
await decide('rep','cancel',rid);
rid=(await post('rep',edit('c1',{phone:'0533333333'}))).requestId;await decide('sup','approve',rid);
await post('owner',edit('c1',{phone:'0544444444'}));
eq((await list('mgr')).requests.find(r=>r.id===rid).stale,true,'the sales manager sees it is out of date');
await decide('mgr','approve',rid,409);eq(row('c1').data.phone,'0544444444','the newer value stays');
await decide('mgr','reject',rid,200,'قديم');
rid=(await post('rep',edit('c1',{phone:'0555555555'}))).requestId;await decide('sup','approve',rid);
await post('mgr',edit('c1',{city:'الأحساء'}));
// A visit fills an empty place, a plan moves: the customer's version moves, the request's fields do not.
sql.prepare("UPDATE crm_records SET version=version+1,data=json_set(data,'$._visitPlan',json('{\"visitId\":\"v\"}')) WHERE id='c1'").run();
eq((await list('mgr')).requests.find(r=>r.id===rid).stale,false,'another field or the version moving leaves it standing');
await decide('mgr','approve',rid);eq([row('c1').data.phone,row('c1').data.city],['0555555555','الأحساء'],'both changes hold');

// The approval and the customer's save are one: if either fails, neither happens.
rid=(await post('rep',edit('c1',{phone:'0566666666'}))).requestId;await decide('sup','approve',rid);before=snapshot('c1');
sql.exec("CREATE TRIGGER fail_decision BEFORE INSERT ON crm_audit WHEN NEW.action='customer-edit:approved' BEGIN SELECT RAISE(ABORT,'injected'); END");
await decide('mgr','approve',rid,500);sql.exec('DROP TRIGGER fail_decision');
eq([snapshot('c1'),pendingOf('c1')[0]?.id],[before,rid],'the customer is untouched and the request still waits');
// A change of the customer between reading and committing: 409, nothing applied.
race=()=>sql.prepare("UPDATE crm_records SET version=version+1 WHERE id='c1'").run();
await decide('mgr','approve',rid,409);race=null;
eq([row('c1').data.phone,pendingOf('c1').length],['0555555555',1],'a concurrent change: nothing applied, still waiting');
await decide('mgr','approve',rid);eq(row('c1').data.phone,'0566666666','and it can then be approved');

// Rights: the sales manager's «تعديل» on «العملاء» switched off; the representative's too; a region the manager does not reach.
rid=(await post('rep',edit('c1',{phone:'0577777777'}))).requestId;await decide('sup','approve',rid);
sql.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_by,updated_at) VALUES('mgr',?,'[]',1,'owner',?)").run(JSON.stringify({'customer:edit':false}),now);
eq((await list('mgr')).requests.find(r=>r.id===rid),undefined,'«تعديل» off: nothing to decide in the list');
await decide('mgr','approve',rid,403);
sql.prepare("DELETE FROM crm_member_permissions WHERE member_id='mgr'").run();
await decide('mgr','approve',rid);
sql.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_by,updated_at) VALUES('rep',?,'[]',1,'owner',?)").run(JSON.stringify({'customer:edit':false}),now);
await post('rep',edit('c1',{phone:'0588888888'}),403);eq(pendingOf('c1').length,0,'the representative with «تعديل» off sends nothing');
sql.prepare("DELETE FROM crm_member_permissions WHERE member_id='rep'").run();
// The sender's rights revoked between reading and committing: no request.
race=null;const memberBefore=sql.prepare("SELECT region_scope FROM crm_members WHERE id='rep'").get();
const prepare=DB.prepare;DB.prepare=q=>{if(q.startsWith('INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) SELECT')&&q.includes("crm_audit WHERE id=?")){sql.prepare("UPDATE crm_members SET region_scope='western' WHERE id='rep'").run();}return prepare(q);};
await post('rep',edit('c1',{phone:'0599999999'}),409);DB.prepare=prepare;sql.prepare("UPDATE crm_members SET region_scope=? WHERE id='rep'").run(memberBefore.region_scope);
eq(pendingOf('c1').length,0,'revoked at commit: no request');

// An edit queued on the device is never accepted (an edit needs a connection, as before): no request, no change.
before=snapshot('c1');
eq((await post('rep',{...edit('c1',{phone:'0500000001'}),offline:{memberId:'rep',capturedAt:new Date().toISOString().replace(/\.\d+Z$/,'.000Z')}},400)).error,'هذا الإجراء يتطلب اتصالًا مباشرًا.','an offline edit: refused');
eq([snapshot('c1'),pendingOf('c1').length],[before,0],'nothing applied, nothing waits');

// A deleted customer's request neither shows nor applies.
customer('gone','rep');rid=(await post('rep',edit('gone',{notes:'late'}))).requestId;
sql.prepare("DELETE FROM crm_records WHERE id='gone'").run();
eq((await list('sup')).requests.some(r=>r.id===rid),false,'a deleted customer shows no request');
await decide('sup','approve',rid,404);await decide('rep','cancel',rid,404);

// Bad decisions.
await decide('mgr','approve','not-a-request',400);await decide('mgr','publish',rid,400);
await decide('mgr','approve','customer-edit:rep:'+crypto.randomUUID(),404);
await post('mgr',{action:'customer-edit',decision:'approve',id:rid,extra:1},400);
// No session.
user(null);eq((await edits.GET(new Request('https://test.invalid/api/customer-edits'))).status,401,'the list without a session: 401');
eq((await crm.POST(request({action:'customer-edit',decision:'cancel',id:rid}))).status,401,'a decision without a session: 401');
eq((await crm.POST(request({action:'customer-edit',decision:'cancel',id:rid},'https://evil.invalid'))).status,403,'another origin: 403');
user('rep');eq((await edits.GET(new Request('https://test.invalid/api/customer-edits?customerId='))).status,400,'an empty customer: 400');
for(const who of ['owner','mgr','sup','rep','cs','csm'])eq(Array.isArray((await list(who)).requests),true,who+' reads a list');
eq(sql.prepare('PRAGMA foreign_key_check').all(),[],'foreign keys hold');
console.log(JSON.stringify({ok:true,checks,scope:'customer edit requests: the rules, every role, the two steps, cancel, reject with a reason, locked fields, a repeated send, stale, atomic approval, rights, offline, a deleted customer',realSqlite:true,productionDataUsed:false}));
