// «ميعاد إعادة تواصل مع الفرصة الخسرانة» (the owner, 2026-11-16, item 8 of the GSCO comparison list; GSCO 2.13.43; lib/followup-recontact.ts)
// without a build, on a migrated in-memory SQLite with the real follow-up route compiled as the build does; the clock is fixed. Synthetic data.
// 1. The rule: only a lost follow-up keeps a re-contact; both or neither; a real day (Arabic and Persian digits), not before the follow-up's
//    day, not in the past (today in Riyadh online, the device's day offline); a lost follow-up or visit saved before stays closed.
// 2. The lists: the follow-up line stays open, «قادمة» until its day and due on it (the follow-ups page's plans, the dashboard's
//    «يستحق المتابعة», the day report's pending follow-ups), and it can be executed like an open one.
// 3. The route (POST /api/customer-followups): saved with the re-contact, refused for a past day, another stage, half of it, a day before
//    the follow-up; the next follow-up executes it on its day, and starting a new cycle closes it; a page of before (without the fields)
//    saves a lost follow-up as before, closed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';

// The clock is fixed at 09:00 in Riyadh on Monday 16 November 2026 and moved forward by the test.
const NativeDate=Date;let clock=NativeDate.parse('2026-11-16T06:00:00.000Z');
globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
const root=process.cwd(),runtime=path.join(root,'.sites-runtime');fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'followup-recontact-')),seen=new Set();
process.on('exit',()=>{globalThis.Date=NativeDate;fs.rmSync(out,{recursive:true,force:true});});
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const id=globalThis.testIdentity;if(!id)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version,email FROM crm_members WHERE id=?').bind(id).first();return {memberId:m?.id,memberVersion:m?.auth_version,email:m?.email,provider:'email-otp'};}`);
function compile(relative){
 if(seen.has(relative))return;seen.add(relative);
 const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});
 let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
  if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));
  if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));
  if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
  let rel=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
  if(!/\.tsx?$/.test(rel))rel+=fs.existsSync(path.join(root,rel+'.ts'))?'.ts':'.tsx';
  compile(rel);return 'from '+JSON.stringify(path.join(out,rel.replace(/\.tsx?$/,'.mjs')));
 });fs.writeFileSync(dest,code);
}
for(const file of ['app/api/customer-followups/route.ts','lib/followup-recontact.ts','lib/customer-followups.ts','lib/customer-visits.ts','lib/daily-followups.ts','lib/crm.ts'])compile(file);
const load=file=>import(pathToFileURL(path.join(out,file)));
const RC=await load('lib/followup-recontact.mjs'),F=await load('lib/customer-followups.mjs'),V=await load('lib/customer-visits.mjs'),DF=await load('lib/daily-followups.mjs'),{today}=await load('lib/crm.mjs');
let checks=0;const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;},ok=(value,message)=>{assert.ok(value,message);checks++;};
const counts={};const counted=async(part,fn)=>{const before=checks;await fn();counts[part]=checks-before;};

// ---- 1. The rule.
await counted('rule',async()=>{
 eq(today(),'2026-11-16','the fixed day');
 const read=(date,action,stage='lost',day='2026-11-16',now='2026-11-16')=>RC.readRecontact({date,action},stage,day,now);
 eq(read('',''),null,'nothing asked: none');eq(read(undefined,undefined),null,'absent: none');
 eq(read('2026-12-01','اتصال بعد شهر'),{date:'2026-12-01',action:'اتصال بعد شهر'},'a lost follow-up keeps a date and its action');
 eq(read('٢٠٢٦-١٢-٠١','اتصال'),{date:'2026-12-01',action:'اتصال'},'Arabic-Indic digits');eq(read('۲۰۲۶-۱۲-۰۱','اتصال'),{date:'2026-12-01',action:'اتصال'},'Persian digits');
 eq(read('2026-11-16','اتصال'),{date:'2026-11-16',action:'اتصال'},'today is allowed');
 eq(read('2026-11-15','اتصال','lost','2026-11-14').error,RC.RECONTACT_MESSAGES.past,'yesterday (after the follow-up\'s own day): refused as past');
 eq(read('2026-11-15','اتصال').error,RC.RECONTACT_MESSAGES.beforeFollowup,'before the follow-up of today: refused');
 eq(read('2026-11-20','اتصال','lost','2026-11-21','2026-11-14').error,RC.RECONTACT_MESSAGES.beforeFollowup,'before the follow-up\'s own day: refused');
 eq(read('2026-11-15','اتصال','lost','2026-11-14','2026-11-14'),{date:'2026-11-15',action:'اتصال'},'offline: the device\'s day decides the past');
 for(const stage of ['won','negotiation','','quoted'])eq(read('2026-12-01','اتصال',stage).error,RC.RECONTACT_MESSAGES.lostOnly,'stage «'+stage+'»: refused');
 eq([read('2026-12-01','').error,read('','اتصال').error,read('2026-12-01','   ').error],[RC.RECONTACT_MESSAGES.bothOrNeither,RC.RECONTACT_MESSAGES.bothOrNeither,RC.RECONTACT_MESSAGES.bothOrNeither],'half of it: refused');
 eq([read('2026-02-30','اتصال').error,read('1/12/2026','اتصال').error,read('soon','اتصال').error],[RC.RECONTACT_MESSAGES.date,RC.RECONTACT_MESSAGES.date,RC.RECONTACT_MESSAGES.date],'not a day: refused');
 ok(read('2026-12-01','x'.repeat(1001)).error,'an action over 1000 letters: refused');
 eq([RC.recontactPlanned({salesStage:'lost',recontact:true,nextDate:'2026-12-01',nextAction:'اتصال'}),RC.recontactPlanned({salesStage:'lost',nextDate:'2026-12-01',nextAction:'اتصال'}),RC.recontactPlanned({salesStage:'won',recontact:true,nextDate:'2026-12-01',nextAction:'اتصال'}),RC.recontactPlanned({salesStage:'lost',recontact:true,nextDate:'',nextAction:'اتصال'}),RC.recontactPlanned(null)],[true,false,false,false,false],'only the marked lost follow-up with its date and action');
 eq([RC.planTracked({salesStage:'specs'}),RC.planTracked({salesStage:'lost'}),RC.planTracked({stage:'won'}),RC.planTracked({followupStatus:'closed'}),RC.planTracked({salesStage:'lost',recontact:true,nextDate:'2026-12-01',nextAction:'اتصال'}),RC.planTracked({})],[true,false,false,false,true,true],'what stays followed');
});

// ---- The database, the records and the route.
const migrations=fs.readdirSync(path.join(root,'drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).sort();
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const name of migrations)sql.exec(fs.readFileSync(path.join(root,'drizzle',name),'utf8'));
class Statement{constructor(q,a=[]){this.q=q;this.a=a;}bind(...a){return new Statement(this.q,a);}async run(){const r=sql.prepare(this.q).run(...this.a);return{meta:{changes:Number(r.changes)}};}async all(){return{results:sql.prepare(this.q).all(...this.a)};}async first(){return sql.prepare(this.q).get(...this.a)||null;}}
const DB={prepare:q=>new Statement(q),batch:async statements=>{sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(/^\s*(SELECT|WITH)/i.test(s.q)?{...await s.all(),meta:{changes:0}}:await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid',YR_AUTH_SECRET:'a'.repeat(64)};
const iso=()=>new Date().toISOString(),member=(id,role,supervisor=null)=>sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,1,0,?)').run(id,'u-'+id,id+'@yourrest.org','اسم '+id,role,'الرئيسي',supervisor,role==='admin'?'all':'eastern',iso());
member('owner','admin');member('sup','supervisor');member('rep','rep','sup');
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-owner')").run();
const insert=(id,kind,parent,data,created=iso())=>sql.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,?,?,?,?,1,?)').run(id,kind,parent,'rep','الرئيسي',JSON.stringify(kind==='customer'?{name:'عميل '+id,region:'الشرقية',...data}:{performedBy:'rep',recordedByEmail:'rep@yourrest.org',responsibleId:'rep',...data}),created,created,'fixture');
const raw=id=>sql.prepare('SELECT * FROM crm_records WHERE id=?').get(id);
const records=()=>sql.prepare('SELECT id,kind,parent_id AS parentId,assigned_to AS assignedTo,branch,data,created_at AS createdAt,updated_at AS updatedAt,version FROM crm_records').all().map(r=>({...r,data:JSON.parse(r.data)}));
const route=await load('app/api/customer-followups/route.mjs');
async function post(payload,status=200,who='rep'){globalThis.testIdentity=who;const response=await route.POST(new Request('https://test.invalid/api/customer-followups',{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json'},body:JSON.stringify(payload)}));const result=await response.json();eq(response.status,status,JSON.stringify(result).slice(0,300));return result;}
const body=(customerId,sourceId,data)=>({createKey:crypto.randomUUID(),customerId,customerVersion:raw(customerId).version,sourceId,sourceVersion:raw(sourceId).version,data:{type:'call',date:today(),result:'تحدثت مع العميل',salesStage:'lost',invoiceOutcome:'pending',nextAction:'',nextDate:'',lossReason:'السعر أعلى من المنافس',lossDetails:'',...data}});
const open=(id)=>{insert(id,'customer',null,{});insert(id+'-v','activity',id,{visitWorkflow:'customer-v1',type:'visit',date:'2026-11-10',summary:'زيارة',result:'العميل مهتم',salesStage:'specs',nextAction:'اتصال',nextDate:'2026-11-12'},'2026-11-10T07:00:00.000Z');return id+'-v';};
const planOf=id=>F.customerFollowupPlans(records()).find(p=>p.customer.id===id);

await counted('route and lists',async()=>{
 // A lost follow-up with a re-contact in two weeks.
 let source=open('c1');
 let saved=await post(body('c1',source,{recontactDate:'٢٠٢٦-١١-٣٠',recontactAction:'اتصال بعد العرض الجديد'}));
 let data=JSON.parse(raw(saved.id).data);
 eq([data.salesStage,data.recontact,data.nextDate,data.nextAction,data.lossReason,data.recontactDate,data.recontactAction],['lost',true,'2026-11-30','اتصال بعد العرض الجديد','السعر أعلى من المنافس',undefined,undefined],'saved: the re-contact in the follow-up\'s next step, Arabic digits read, the request fields not stored as such');
 eq(JSON.parse(raw('c1').data)._visitPlan,{visitId:saved.id,date:'2026-11-16',nextDate:'2026-11-30',nextAction:'اتصال بعد العرض الجديد'},'the customer\'s plan carries it');
 let plan=planOf('c1');eq([plan.closed,plan.recontact,plan.nextDate,plan.stage],[false,true,'2026-11-30','lost'],'the line stays open, a re-contact, «تم الفقد»');
 ok(F.canExecuteCustomerFollowup(plan.source),'and can be executed');
 eq(V.customerVisitDue(records()).map(r=>r.id).includes(saved.id),true,'among the plans the dashboard reads');
 const dueOn=day=>V.customerVisitDue(records()).filter(r=>r.id===saved.id&&(!r.data.nextDate||!r.data.nextAction||r.data.nextDate<=day)).length;
 eq([dueOn('2026-11-16'),dueOn('2026-11-29'),dueOn('2026-11-30'),dueOn('2026-12-05')],[0,0,1,1],'«يستحق المتابعة»: not before its day, due on it and after');
 const pending=day=>DF.dailyPendingFollowups(records(),[{id:'rep',name:'اسم rep',email:'rep@yourrest.org',role:'rep',branch:'الرئيسي',active:1,target:0}],new Set(['rep']),day,'all').filter(f=>f.customerId==='c1').map(f=>[f.nextDate,f.nextAction]);
 eq([pending('2026-11-29'),pending('2026-11-30')],[[],[['2026-11-30','اتصال بعد العرض الجديد']]],'the day report\'s pending follow-ups: on its day');
 // Refusals.
 source=open('c2');
 for(const [fields,message] of [[{date:'2026-11-15',recontactDate:'2026-11-15',recontactAction:'اتصال'},RC.RECONTACT_MESSAGES.past],[{recontactDate:'2026-12-01',recontactAction:''},RC.RECONTACT_MESSAGES.bothOrNeither],[{recontactDate:'',recontactAction:'اتصال'},RC.RECONTACT_MESSAGES.bothOrNeither],[{recontactDate:'2026-12-01',recontactAction:'اتصال',salesStage:'won',invoiceOutcome:'pending',lossReason:''},RC.RECONTACT_MESSAGES.lostOnly],[{recontactDate:'2026-12-01',recontactAction:'اتصال',salesStage:'negotiation',lossReason:'',nextAction:'متابعة',nextDate:'2026-11-20'},RC.RECONTACT_MESSAGES.lostOnly],[{recontactDate:'2026-12-31x',recontactAction:'اتصال'},RC.RECONTACT_MESSAGES.date]]){
  const result=await post(body('c2',source,fields),400);eq(result.error,message,'refused: '+JSON.stringify(fields));
 }
 eq(sql.prepare("SELECT COUNT(*) n FROM crm_records WHERE parent_id='c2' AND json_extract(data,'$.visitWorkflow')='followup-v1'").get().n,0,'nothing saved');
 // A page of before (no re-contact fields): a lost follow-up is closed, as before.
 const legacy=body('c2',source,{});delete legacy.data.recontactDate;delete legacy.data.recontactAction;legacy.data.nextAction='زيارة';legacy.data.nextDate='2026-11-20';
 saved=await post(legacy);data=JSON.parse(raw(saved.id).data);
 eq([data.nextDate,data.nextAction,data.recontact],['','',undefined],'without the fields: closed, the next step cleared as before');
 eq([planOf('c2').closed,F.canExecuteCustomerFollowup(planOf('c2').source)],[true,false],'and the line closed');
 // A lost visit saved before (it always carries a next step) stays closed: no re-contact without the mark.
 insert('c3','customer',null,{});insert('c3-v','activity','c3',{visitWorkflow:'customer-v1',type:'visit',date:'2026-11-10',summary:'زيارة',result:'رفض',salesStage:'lost',nextAction:'اتصال',nextDate:'2026-11-12'},'2026-11-10T07:00:00.000Z');
 eq(planOf('c3').closed,true,'a lost visit of before: closed');eq(V.customerVisitDue(records()).some(r=>r.id==='c3-v'),false,'and not on the dashboard');
 // On the day, the re-contact is executed: a new cycle, at no stage, with its own next step.
 clock=NativeDate.parse('2026-11-30T06:00:00.000Z');eq(today(),'2026-11-30','the re-contact day');
 plan=planOf('c1');
 saved=await post(body('c1',plan.source.id,{salesStage:'',lossReason:'',nextAction:'إرسال عرض جديد',nextDate:'2026-12-03',result:'العميل مستعد لعرض جديد'}));
 plan=planOf('c1');eq([plan.source.id,plan.closed,plan.recontact,plan.nextDate,plan.stage],[saved.id,false,false,'2026-12-03',''],'executed on its day: the line goes on with the new step');
 // Lost again without a date: closed. A minute later (two follow-ups of the same instant would be ordered by their random ids).
 clock+=60000;saved=await post(body('c1',plan.source.id,{date:'2026-11-30'}));eq(planOf('c1').closed,true,'lost again without a re-contact: closed');
});

eq(fs.readdirSync(path.join(root,'drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).length,21,'no new migration (21)');
console.log(JSON.stringify({ok:true,checks,parts:counts}));
