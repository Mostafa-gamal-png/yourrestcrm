// The customer-service queue a sales reader receives: stages, response targets in working hours, who must act, what
// escalates, the sort order, the badge and the fields that must never appear. Pure functions over an in-memory
// context; the same compiled domain modules as production. No database, no network, no production data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'service-queue-')),seen=new Set();
process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
function compile(relative){
 if(seen.has(relative))return;seen.add(relative);
 const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});
 let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
  if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
  let child=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
  if(!/\.tsx?$/.test(child))child+=fs.existsSync(path.join(root,child+'.ts'))?'.ts':'.tsx';
  compile(child);return 'from '+JSON.stringify(path.join(out,child.replace(/\.tsx?$/,'.mjs')));
 });
 fs.writeFileSync(dest,code);
}
compile('lib/working-hours.ts');compile('lib/service-queue.ts');
const hours=await import(path.join(out,'lib/working-hours.mjs')),queue=await import(path.join(out,'lib/service-queue.mjs'));
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual===undefined?undefined:JSON.parse(JSON.stringify(actual)),expected,message);checks++;};

// ---- working hours (Riyadh is UTC+3; 2026-10-08 is a Thursday, 2026-10-09 a Friday, 2026-10-10 a Saturday, 2026-10-12 a Monday)
const at=(date,hhmm)=>date+'T'+hhmm+':00+03:00';
const wh=(a,b)=>hours.workingHoursBetween(a,b);
eq(wh(at('2026-10-12','10:00'),at('2026-10-12','12:00')),2,'two hours inside one working day');
eq(wh(at('2026-10-12','09:30'),at('2026-10-12','10:15')),0.75,'partial hours');
eq(wh(at('2026-10-12','06:00'),at('2026-10-12','09:00')),1,'time before 08:00 does not count');
eq(wh(at('2026-10-12','17:00'),at('2026-10-12','21:00')),1,'time after 18:00 does not count');
eq(wh(at('2026-10-12','08:00'),at('2026-10-12','18:00')),10,'a full working day is ten hours');
eq(wh(at('2026-10-12','17:00'),at('2026-10-13','09:00')),2,'an overnight wait counts the hour before closing and the hour after opening');
eq(wh(at('2026-10-08','17:00'),at('2026-10-10','09:00')),2,'Friday in between adds nothing');
eq(wh(at('2026-10-09','09:00'),at('2026-10-09','17:00')),0,'a Friday alone is zero');
eq(wh(at('2026-10-11','08:00'),at('2026-10-13','08:00')),20,'two working days');
eq(wh(at('2026-10-12','12:00'),at('2026-10-12','11:00')),0,'reversed order is zero');
eq(wh('nonsense',at('2026-10-12','11:00')),0,'an invalid instant is zero');
eq(wh('2026-10-12T04:00:00.000Z','2026-10-12T06:00:00.000Z'),1,'instants are read as UTC and shifted to Riyadh: 07:00 to 09:00 there counts only the hour after opening');

// ---- a synthetic context: the domain functions decide visibility and permissions exactly as the API does.
const m=(id,role,supervisorId,regionScope='all')=>({id,userId:'u-'+id,email:id+'@yourrest.org',name:id,role,branch:'الرئيسي',supervisorId,regionScope,active:1,target:0});
const members=[m('owner','admin'),m('sm','manager'),m('sm2','manager'),m('sup','supervisor','sm'),m('rep','rep','sup'),m('rep2','rep','sup'),m('outside','rep','other'),m('csm','customer_service_manager','sm'),m('cs','customer_service','csm')];
const customer=(id,assignedTo)=>({id,kind:'customer',parentId:null,assignedTo,branch:'الرئيسي',data:{name:'مصنع '+id,region:'الشرقية',phone:'0500000000',city:'الدمام'},createdAt:'2026-10-01T05:00:00.000Z',updatedAt:'2026-10-01T05:00:00.000Z',version:3});
const contact=(id,caseId,author,createdAt)=>({id,kind:'activity',parentId:'c-'+caseId.slice(-1),assignedTo:author,branch:'الرئيسي',data:{type:'call',date:createdAt.slice(0,10),result:'تم',salesStage:'new',nextAction:'اتصال','nextDate':'2026-10-20',serviceCaseId:caseId,performedBy:author,responsibleId:author,recordedByEmail:author+'@yourrest.org'},createdAt,updatedAt:createdAt,version:1});
const brief={source:'call',products:['خدمات صيانة'],strength:'strong',needs:'سري: نص التسجيل لا يظهر إلا في الملخص',nextAction:'زيارة',nextDate:'2026-10-14',registration:{summary:'PRIVATE-REGISTRATION-TEXT',competitorFileName:'PRIVATE-FILE.pdf'}};
const kase=(id,customerId,status,fields,data={})=>({id,customerId,status,creatorId:'cs',serviceManagerId:'csm',salesManagerId:'sm',assignedTo:null,supervisorId:null,...fields,data:{...brief,...data},createdAt:'2026-10-12T05:00:00.000Z',updatedAt:'2026-10-12T05:00:00.000Z',version:2});
const cases=[
 kase('case-1','c-1','pending_assignment',{},{approvedAt:'2026-10-12T05:30:00.000Z'}),                                         // waits for sm since Monday 08:30 Riyadh
 kase('case-2','c-2','assigned',{assignedTo:'sup',supervisorId:'sup'},{assignedAt:'2026-10-12T06:00:00.000Z'}),                 // with the supervisor since 09:00
 kase('case-3','c-3','assigned',{assignedTo:'rep',supervisorId:'sup'},{assignedAt:'2026-10-11T06:00:00.000Z',delegatedAt:'2026-10-11T07:00:00.000Z',assignmentNote:'ركّز على قطع الغيار',assignmentNoteBy:'sm',seenAt:'2026-10-11T08:00:00.000Z',seenBy:'rep'}), // first contact pending since Sunday 10:00
 kase('case-4','c-4','assigned',{assignedTo:'rep2',supervisorId:'sup'},{assignedAt:'2026-10-05T06:00:00.000Z'}),                // followed up
 kase('case-5','c-5','pending_assignment',{salesManagerId:'sm2'},{approvedAt:'2026-10-12T05:30:00.000Z',strength:'weak'}),       // another manager's
 kase('case-6','c-6','pending_approval',{salesManagerId:null},{}),
 kase('case-7','c-7','returned',{salesManagerId:null},{}),
 kase('case-8','c-8','assigned',{assignedTo:'rep',supervisorId:'sup'},{assignedAt:'2026-10-05T06:00:00.000Z',reassignedAt:'2026-10-12T06:00:00.000Z',previousAssignees:['rep2']}) // moved to rep today; rep2 had contacted before
];
const all=[customer('c-1','rep'),customer('c-2','outside'),customer('c-3','rep'),customer('c-4','rep2'),customer('c-5','cs'),customer('c-6','cs'),customer('c-7','cs'),customer('c-8','rep'),contact('k-4a','case-4','rep2','2026-10-06T07:00:00.000Z'),contact('k-8a','case-8','rep2','2026-10-07T07:00:00.000Z')];
const scoped=(me)=>{const visible=me.role==='admin'?all:all.filter(r=>r.kind==='customer'||['rep','rep2','sup'].includes(r.assignedTo)&&(me.role==='manager'||me.role==='supervisor'||r.assignedTo===me.id));return {me,members,all,visible,serviceCases:cases};};
const now='2026-10-12T12:00:00.000Z'; // Monday 15:00 Riyadh
const run=(id)=>queue.serviceQueue(scoped(members.find(x=>x.id===id)),now);
const byId=(entries,id)=>entries.find(e=>e.id===id);

// -- customer service never gets a queue (they have their rows)
eq(run('cs'),[],'a customer-service representative gets no queue');
eq(run('csm'),[],'nor a customer-service manager');

// -- the sales manager
let sm=run('sm');
eq(sm.map(e=>e.id),['case-1','case-2','case-4','case-3','case-8'],'manager: his pending assignment first, then the late case, then the rest by strength and age; another manager\'s case and unapproved cases are absent');
eq([byId(sm,'case-1').stage,byId(sm,'case-1').awaiting,byId(sm,'case-1').ownerId,byId(sm,'case-1').targetHours,byId(sm,'case-1').stageHours,byId(sm,'case-1').late],['assignment','assign','sm',4,6.5,true],'case-1 waits for the manager since 08:30, 6.5 working hours, late against 4');
eq(byId(sm,'case-1').currentRepId,'rep','the customer\'s current representative is suggested');
eq([byId(sm,'case-2').stage,byId(sm,'case-2').awaiting,byId(sm,'case-2').ownerId,byId(sm,'case-2').late,byId(sm,'case-2').escalated],['delegation',null,'sup',true,true],'case-2 sits with the supervisor for 6 hours: late, escalated to the manager');
eq([byId(sm,'case-3').stage,byId(sm,'case-3').stageHours,byId(sm,'case-3').late,byId(sm,'case-3').escalated,byId(sm,'case-3').assignmentNote,byId(sm,'case-3').seenByName],['first_contact',15,false,false,'ركّز على قطع الغيار','rep'],'case-3: delegated Sunday 10:00, 15 working hours so far, within the 24-hour target; the note and the opening are reported');
eq([byId(sm,'case-4').stage,byId(sm,'case-4').targetHours,byId(sm,'case-4').late,byId(sm,'case-4').contactCount,byId(sm,'case-4').salesStage],['follow_up',null,false,1,'new'],'a contacted case is in follow-up with no target');
eq([byId(sm,'case-8').stage,byId(sm,'case-8').contactCount,byId(sm,'case-8').contactsSinceDispatch,byId(sm,'case-8').late],['first_contact',1,0,false],'after re-assignment the earlier holder\'s contact does not count as the new holder\'s first contact');
eq(queue.serviceQueueBadge(sm),2,'manager badge: one to assign plus one escalated');
eq(JSON.stringify(sm).includes('PRIVATE'),false,'no registration text or attachment name in the queue');
eq(Object.keys(byId(sm,'case-1')).some(key=>/registration/i.test(key)),false,'no registration field at all');

// -- the supervisor
let sup=run('sup');
eq(sup.map(e=>e.id),['case-2','case-4','case-3','case-8'],'supervisor: his delegation first, then his representatives\' cases by age (nothing of his is late)');
eq([byId(sup,'case-2').awaiting,byId(sup,'case-2').permissions.delegate,byId(sup,'case-2').permissions.followup],['delegate',true,true],'the supervisor must delegate or follow up himself');
eq([byId(sup,'case-3').awaiting,byId(sup,'case-3').escalated,byId(sup,'case-3').permissions.delegate],[null,false,true],'a representative\'s pending first contact within target: nothing for the supervisor yet, but he may re-delegate');
eq(queue.serviceQueueBadge(sup),1,'supervisor badge: his delegation');
eq(byId(sup,'case-1'),undefined,'a case still waiting for the manager is not visible to the supervisor');

// -- the representative
let rep=run('rep');
eq(rep.map(e=>e.id),['case-3','case-8'],'representative: only cases assigned to him');
eq([byId(rep,'case-3').awaiting,byId(rep,'case-3').permissions.followup,byId(rep,'case-3').permissions.seen,byId(rep,'case-3').permissions.reassign],['first_contact',true,true,false],'the representative must make the first contact; he may mark it opened; he never re-assigns');
eq(queue.serviceQueueBadge(rep),2,'representative badge: two new cases');
eq(JSON.stringify(rep).includes('PRIVATE'),false,'the representative\'s queue carries no registration text');

// -- late first contact escalates to the supervisor and the manager
const late=queue.serviceQueue(scoped(members.find(x=>x.id==='sup')),'2026-10-15T12:00:00.000Z');
eq([byId(late,'case-3').late,byId(late,'case-3').escalated],[true,true],'three days later the representative\'s first contact is late and escalated to the supervisor');
eq(queue.serviceQueueBadge(queue.serviceQueue(scoped(members.find(x=>x.id==='sm')),'2026-10-15T12:00:00.000Z'))>=3,true,'and to the manager');
eq(byId(queue.serviceQueue(scoped(members.find(x=>x.id==='rep')),'2026-10-15T12:00:00.000Z'),'case-3').escalated,false,'never to the holder himself');

// -- the administrator
const owner=run('owner');
eq(owner.map(e=>e.id).sort(),['case-1','case-2','case-3','case-4','case-5','case-6','case-7','case-8'],'the administrator sees every case');
eq([byId(owner,'case-6').stage,byId(owner,'case-6').awaiting,byId(owner,'case-6').ownerId,byId(owner,'case-6').targetHours],['approval','approve','csm',4],'an unapproved case waits for the customer-service manager; the administrator may approve too');
eq([byId(owner,'case-7').stage,byId(owner,'case-7').ownerId,byId(owner,'case-7').targetHours,byId(owner,'case-7').late],['returned','cs',null,false],'a returned case waits for its registrar with no target');
eq(byId(owner,'case-5').permissions.assign,true,'the administrator assigns any manager\'s case');

// -- stage facts and sorting
eq(queue.queueStage({status:'assigned',data:{assignedAt:'2026-10-01T05:00:00.000Z',reassignedAt:'2026-10-03T05:00:00.000Z'},createdAt:'',updatedAt:''},'assigned',0,'rep'),{stage:'first_contact',since:'2026-10-03T05:00:00.000Z'},'the newest dispatch starts the clock');
eq(queue.queueStage({status:'assigned',data:{},createdAt:'',updatedAt:'2026-10-02T05:00:00.000Z'},'won',0,'rep'),{stage:'closed',since:'2026-10-02T05:00:00.000Z'},'won closes');
eq(queue.queueStage({status:'pending_approval',data:{resubmittedAt:'2026-10-04T05:00:00.000Z'},createdAt:'2026-10-01T05:00:00.000Z',updatedAt:''},'pending_approval',0,''),{stage:'approval',since:'2026-10-04T05:00:00.000Z'},'a resubmitted case restarts the approval clock');
const sorted=queue.sortQueue([{id:'b',awaiting:null,late:false,strength:'strong',stageSince:'1'},{id:'a',awaiting:'assign',late:false,strength:'weak',stageSince:'2'},{id:'c',awaiting:null,late:true,strength:'weak',stageSince:'3'},{id:'d',awaiting:null,late:false,strength:'strong',stageSince:'0'}]);
eq(sorted.map(e=>e.id),['a','c','d','b'],'mine, then late, then strength, then oldest');
eq(queue.SERVICE_TARGET_HOURS,{approval:4,assignment:4,delegation:4,first_contact:24},'targets as decided');

// ---- panel sections per role
const ids=groups=>groups.map(g=>g.id+':'+g.entries.map(e=>e.id).join('+'));
eq(ids(queue.queueGroups(sm,'manager')),['mine:case-1','late:case-2','active:case-4+case-3+case-8','closed:'],'manager sections: his to-do, what is late below him, the rest');
eq(ids(queue.queueGroups(sup,'supervisor')),['mine:case-2','late:','active:case-4+case-3+case-8','closed:'],'supervisor sections');
eq(ids(queue.queueGroups(rep,'rep')),['new:case-3+case-8','active:','closed:'],'representative sections: new first');
eq(ids(queue.queueGroups(owner,'admin')).slice(0,2),['mine:case-6+case-1+case-5','late:case-2'],'administrator: approvals and assignments first (late, strong and oldest first), then every other late case');
const closedEntry={...byId(sm,'case-4'),id:'done',stage:'closed',awaiting:null,late:false,escalated:false};
eq(ids(queue.queueGroups([closedEntry],'manager')),['mine:','late:','active:','closed:done'],'closed cases are kept apart');
eq(ids(queue.queueGroups([closedEntry],'rep')),['new:','active:','closed:done'],'also for a representative');

// ---- reporting-line warnings on the team page
const warn=(member)=>queue.serviceRoleWarning(member,members);
eq(warn(members.find(x=>x.id==='cs')),'','a linked representative has no warning');
eq(warn({id:'cs3',role:'customer_service',supervisorId:'',active:1}),'no_service_manager','a representative without a manager');
eq(warn({id:'cs4',role:'customer_service',supervisorId:'sm',active:1}),'no_service_manager','a representative under a sales manager (not a customer-service manager)');
eq(warn({id:'cs5',role:'customer_service',supervisorId:'ghost',active:1}),'no_service_manager','a representative under an unknown member');
eq(warn(members.find(x=>x.id==='csm')),'','a linked customer-service manager has no warning');
eq(warn({id:'csm2',role:'customer_service_manager',supervisorId:'',active:1}),'no_sales_manager','a customer-service manager without a sales manager');
eq(warn({id:'csm3',role:'customer_service_manager',supervisorId:'sup',active:1}),'no_sales_manager','under a supervisor is not a manager');
eq(warn({id:'cs6',role:'customer_service',supervisorId:'',active:0}),'','a disabled member needs no warning');
eq(queue.serviceRoleWarning({id:'cs7',role:'customer_service',supervisorId:'csm-off',active:1},[...members,{id:'csm-off',role:'customer_service_manager',active:0}]),'no_service_manager','a disabled manager does not count');
eq(warn(members.find(x=>x.id==='rep')),'','other roles never warn');

console.log(JSON.stringify({ok:true,checks,pureFunctions:true,productionDataUsed:false}));
