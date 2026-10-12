// What the Android app asks every ten minutes: the customer-service requests that wait for the reader personally,
// worded for a notification, and nothing else. Pure functions over an in-memory context; the same compiled domain
// modules as production. No database, no network, no production data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'service-alerts-')),seen=new Set();
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
compile('lib/service-alerts.ts');
const alerts=await import(path.join(out,'lib/service-alerts.mjs'));
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual===undefined?undefined:JSON.parse(JSON.stringify(actual)),expected,message);checks++;};

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


const ask=(id,at=now,list=cases)=>alerts.serviceAlerts({...scoped(members.find(x=>x.id===id)),serviceCases:list},at);
const brief3=(entry)=>[entry.id,entry.awaiting,entry.seen];

// ---- who is told what
let sm=ask('sm');
eq(sm.alerts.map(brief3),[['case-1','assign',false]],'the manager is told of the one request waiting for his assignment');
eq([sm.memberId,sm.generatedAt,sm.count],['sm',now,2],'the answer names the member and the time; the count is the same badge the page shows (one to assign, one escalated)');
eq(sm.alerts[0],{id:'case-1',customerName:'مصنع c-1',need:'سري: نص التسجيل لا يظهر إلا في الملخص',awaiting:'assign',seen:false,since:'2026-10-12T05:30:00.000Z'},'exactly the fields a notification needs');
eq(ask('sm2').alerts.map(brief3),[['case-5','assign',false]],'another manager is told of his own');
eq(ask('sup').alerts.map(brief3),[['case-2','delegate',false]],'the supervisor is told of the request to delegate, not of his representatives\' cases');
eq([ask('sup').count],[1],'and his badge counts it');
const rep=ask('rep');
eq(rep.alerts.map(brief3),[['case-3','first_contact',true],['case-8','first_contact',false]],'the representative is told of both requests waiting for his first contact, one of them already opened');
eq(rep.alerts.map(a=>a.since),['2026-10-11T07:00:00.000Z','2026-10-12T06:00:00.000Z'],'each carries when it began waiting for him, so a re-assignment back is a new alert');
eq(ask('rep2').alerts,[],'a representative who holds nothing waiting is told nothing (his follow-up case is not a first contact)');
const owner=ask('owner');
eq([owner.alerts,owner.count>0],[[],true],'the administrator may act on any case, but is not personally waited for: no alerts, the badge still counts');
eq([ask('cs'),ask('csm')].map(a=>[a.alerts,a.count]),[[[],0],[[],0]],'customer service has its own screens: nothing');
eq(ask('outside').alerts,[],'a representative outside the case chain is told nothing');

// ---- time moves the same request on without repeating it
eq(ask('sm','2026-10-15T12:00:00.000Z').alerts.map(brief3),[['case-1','assign',false]],'three days on it still waits, with the same start');
const assigned=cases.map(item=>item.id==='case-1'?{...item,status:'assigned',assignedTo:'rep2',supervisorId:'sup',data:{...item.data,assignedAt:'2026-10-12T09:00:00.000Z'}}:item);
eq([ask('sm',now,assigned).alerts.map(a=>a.id),ask('rep2',now,assigned).alerts.map(brief3)],[[],[['case-1','first_contact',false]]],'once assigned it leaves the manager and reaches the new holder');

// ---- the need is short and one line; the list is bounded; nothing private is carried
const wordy=cases.map(item=>item.id==='case-1'?{...item,data:{...item.data,needs:'قالب جديد\n   وصيانة   للقالب الحالي '+'ي'.repeat(120)}}:item);
const need=ask('sm',now,wordy).alerts[0].need;
eq([need.length,need.includes('\n'),need.endsWith('…'),need.startsWith('قالب جديد وصيانة للقالب الحالي ')],[80,false,true,true],'the need is collapsed to one line and cut at 80 characters');
const many=[...cases,...Array.from({length:25},(_,n)=>kase('bulk-'+n,'c-1','pending_assignment',{},{approvedAt:'2026-10-12T05:30:00.000Z'}))];
const bulk=ask('sm',now,many);
eq([bulk.alerts.length,bulk.count>=26],[20,true],'at most twenty alerts are sent, while the count stays honest');
for(const id of ['sm','sup','rep','owner','sm2']){
 const text=JSON.stringify(ask(id));
 eq([id,/PRIVATE|0500000000|registration|competitor|الدمام/i.test(text)],[id,false],id+': no registration text, attachment, phone or city');
}
eq(Object.keys(ask('sm').alerts[0]).sort(),['awaiting','customerName','id','need','seen','since'],'the alert has no other field');
eq(Object.keys(ask('sm')).sort(),['alerts','count','generatedAt','memberId'],'nor the answer');

console.log(JSON.stringify({ok:true,checks,pureFunctions:true,productionDataUsed:false}));
