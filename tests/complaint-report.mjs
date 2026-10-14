// The monthly complaints report: counts by category, channel, region and severity, the current states, what went a step
// back, resolution and closure outcomes and the satisfaction share, stage timings in working hours against their targets,
// the open ones that are late now, and who may read it. Pure functions over an in-memory context; the same compiled domain
// modules as production. No database, no network, no production data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'complaint-report-')),seen=new Set();
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
compile('lib/complaint-report.ts');
const report=await import(path.join(out,'lib/complaint-report.mjs'));
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual===undefined?undefined:JSON.parse(JSON.stringify(actual)),expected,message);checks++;};

// ---- who may read it
eq(['admin','manager','customer_service_manager','supervisor','rep','customer_service','unknown'].map(report.complaintReportAllowed),[true,true,true,false,false,false,false],'administrators, sales managers and customer-service managers only');

// ---- a synthetic company: two branches, two sales managers, two customer-service managers (Riyadh is UTC+3; 2026-09-06 is a Sunday)
const m=(id,role,supervisorId,branch='الرئيسي')=>({id,userId:'u-'+id,email:id+'@yourrest.org',name:'عضو '+id,role,branch,supervisorId,regionScope:'all',active:1,target:0});
const members=[m('owner','admin'),m('sm','manager'),m('sm2','manager'),m('sup','supervisor','sm'),m('sup2','supervisor','sm2'),m('rep','rep','sup'),m('rep2','rep','sup'),m('rep_b','rep','sup2','فرع آخر'),
 m('csm','customer_service_manager','sm'),m('cs','customer_service','csm'),m('csm2','customer_service_manager','sm2'),m('cs2','customer_service','csm2'),m('csm_b','customer_service_manager','sm2','فرع آخر'),m('cs_b','customer_service','csm_b','فرع آخر')];
const customer=(id,assignedTo,region,branch='الرئيسي')=>({id,kind:'customer',parentId:null,assignedTo,branch,data:{name:'مصنع '+id,region,phone:'0500000000',city:'الدمام'},createdAt:'2026-08-01T05:00:00.000Z',updatedAt:'2026-08-01T05:00:00.000Z',version:1});
const customers=[customer('c1','rep','الشرقية'),customer('c2','rep','الشرقية'),customer('c3','rep2','الغربية'),customer('c4','rep','الشرقية'),customer('c6','rep_b','الشرقية','فرع آخر')];
const T=(day,hour)=>'2026-09-'+String(day).padStart(2,'0')+'T'+String(hour).padStart(2,'0')+':00:00.000Z';
const base={kind:'complaint',status:'submitted',registrarId:'cs',serviceManagerId:'csm',salesManagerId:'',supervisorId:'',assigneeId:'',channel:'call',category:'product_quality',severity:'normal',description:'PRIVATE-DESCRIPTION',demand:'PRIVATE-DEMAND',reference:'INV-1',contactName:'PRIVATE-CONTACT',contactPhone:'0500000000',
 submittedAt:'',forwardedAt:'',returnedAt:'',assignedAt:'',delegatedAt:'',reassignedAt:'',rejectedAt:'',reopenedAt:'',resolvedAt:'',closedAt:'',cancelledAt:'',seenAt:'',returnNote:'',assignmentNote:'',rejectReason:'',cancelReason:'',previousAssignees:[],updates:[],notes:[],events:[]};
const update=(at)=>({id:'u-'+at,at,by:'rep',channel:'call',date:at.slice(0,10),text:'PRIVATE-UPDATE'});
const complaint=(id,createdAt,data)=>{const merged={...base,submittedAt:createdAt,...data};return {id:'complaint-'+id,branch:customers.find(c=>c.id===merged.customerId).branch,assignedTo:merged.registrarId,data:merged,createdAt,updatedAt:merged.closedAt||merged.cancelledAt||createdAt,version:3};};
const sales={salesManagerId:'sm',supervisorId:'sup',assigneeId:'rep'};
const complaints=[
 // A: registered Sunday 08:00, forwarded after 1h, assigned 2h later, first contact 1h later, resolved Monday 08:00, closed Monday 10:00 without the customer's satisfaction
 complaint('A',T(6,5),{customerId:'c1',status:'closed',...sales,forwardedAt:T(6,6),assignedAt:T(6,8),updates:[update(T(6,9))],resolvedAt:T(7,5),resolution:{outcome:'solved',note:'PRIVATE-RESOLUTION',by:'rep',at:T(7,5)},closedAt:T(7,7),closure:{outcome:'not_satisfied',note:'PRIVATE-CLOSURE',by:'cs',at:T(7,7)}}),
 // B: high; returned once and resubmitted; assigned to the supervisor who delegated after an hour; first contact Wednesday 08:00; resolved, sent back, resolved again Thursday 08:00; still waiting for closure
 complaint('B',T(7,5),{customerId:'c2',status:'resolved',severity:'high',channel:'whatsapp',category:'delivery_delay',...sales,returnedAt:T(7,6),submittedAt:T(7,7),forwardedAt:T(7,9),assignedAt:T(7,11),delegatedAt:T(7,12),updates:[update(T(9,5))],rejectedAt:T(9,8),rejectReason:'PRIVATE-REASON',resolvedAt:T(10,5),resolution:{outcome:'partially_solved',note:'PRIVATE-RESOLUTION',by:'rep',at:T(10,5)}}),
 // C: forwarded after an hour on Tuesday; the sales manager has not assigned it
 complaint('C',T(8,5),{customerId:'c3',status:'pending_assignment',channel:'email',category:'invoice_price',salesManagerId:'sm',forwardedAt:T(8,6)}),
 // D: August, cancelled
 complaint('D','2026-08-31T05:00:00.000Z',{customerId:'c1',status:'cancelled',channel:'email',category:'other',cancelledAt:'2026-08-31T06:00:00.000Z'}),
 // E: the other customer-service manager's team, cancelled an hour after registration
 complaint('E',T(9,5),{customerId:'c4',status:'cancelled',registrarId:'cs2',serviceManagerId:'csm2',channel:'website',category:'service_conduct',cancelledAt:T(9,6),cancelReason:'PRIVATE-CANCEL'}),
 // F: the other branch, routed to the other sales manager and assigned Thursday 10:00; no contact yet
 complaint('F',T(10,5),{customerId:'c6',status:'assigned',registrarId:'cs_b',serviceManagerId:'csm_b',salesManagerId:'sm2',supervisorId:'sup2',assigneeId:'rep_b',category:'maintenance_support',forwardedAt:T(10,6),assignedAt:T(10,7)}),
 // G: the same customer as A; closed, reopened Monday 10:00, resolved again at noon and closed at 14:00 with the customer satisfied
 complaint('G',T(6,6),{customerId:'c1',status:'closed',channel:'visit',...sales,forwardedAt:T(6,7),assignedAt:T(6,8),updates:[update(T(6,9))],reopenedAt:T(7,7),resolvedAt:T(7,9),resolution:{outcome:'solved',note:'PRIVATE-RESOLUTION',by:'rep',at:T(7,9)},closedAt:T(7,11),closure:{outcome:'satisfied',note:'PRIVATE-CLOSURE',by:'cs',at:T(7,11)}})
];
const ctx=id=>({me:members.find(x=>x.id===id),members,all:customers,complaints});
const run=(id,month='2026-09',now='2026-10-12T12:00:00.000Z')=>report.complaintReport(ctx(id),month,now);
const timing=(n,median,average,target,overTarget)=>({n,median,average,target,overTarget});
const row=(key,total,open,closed,satisfied,satisfactionRate)=>({key,total,open,closed,satisfied,satisfactionRate});

// ---- the administrator sees every complaint of the month
let r=run('owner');
eq([r.month,r.total,r.open,r.closed,r.cancelled,r.high,r.satisfied,r.satisfactionRate],['2026-09',6,3,2,1,1,1,50],'September: six complaints, three open, two closed, one cancelled, one high, one of the two closed ones with the customer satisfied');
eq([r.openOverTarget,r.repeatCustomers],[3,1],'in October all three open ones are past their stage target; one customer complained twice');
eq(r.flow,{returned:1,sentBack:1,reassigned:0,reopened:1},'what went a step back: B was returned for correction and sent back to the representative, G was reopened');
eq(r.byState,{closed:2,resolved:1,pending_assignment:1,assigned:1,cancelled:1},'by current state');
eq(r.byCategory,[row('product_quality',2,0,2,1,50),row('delivery_delay',1,1,0,0,null),row('invoice_price',1,1,0,0,null),row('maintenance_support',1,1,0,0,null),row('service_conduct',1,0,0,0,null)],'by category, busiest first then by key; satisfaction only where something closed');
eq(r.byChannel,[row('call',2,1,1,0,0),row('email',1,1,0,0,null),row('visit',1,0,1,1,100),row('website',1,0,0,0,null),row('whatsapp',1,1,0,0,null)],'by channel');
eq(r.bySeverity,[row('normal',5,2,2,1,50),row('high',1,1,0,0,null)],'by severity');
eq(r.byRegion,[row('الشرقية',5,2,2,1,50),row('الغربية',1,1,0,0,null)],'by the customer\'s region');
eq(r.resolutionOutcomes,[{key:'solved',count:2},{key:'partially_solved',count:1}],'the resolutions standing now');
eq(r.closureOutcomes,[{key:'not_satisfied',count:1},{key:'satisfied',count:1}],'the closures');
eq(r.timing.review,timing(5,1,1.2,4,0),'review: 1, 2 (B, from its resubmission), 1, 1, 1 working hours; a cancelled complaint has none');
eq(r.timing.assignment,timing(4,1.5,1.5,4,0),'assignment: 2, 2, 1, 1 hours');
eq(r.timing.firstContact,timing(3,1,5,24,0),'first contact: 1 hour for A and G; 13 working hours for B from the delegation (Monday 15:00 to Wednesday 08:00)');
eq(r.timing.resolution,timing(3,7,5.33,50,0),'resolution from the dispatch before it: A 7 hours (Sunday 11:00 to Monday 08:00), B 7 hours from being sent back, G 2 hours from the reopening');
eq(r.timing.closure,timing(2,2,2,24,0),'closure confirmation: 2 hours for A and for G');
eq(r.timing.registrationToClosure,timing(2,13.5,13.5,null,0),'registration to closure: 12 and 15 working hours; no target');
eq(r.months,['2026-09','2026-08'],'months offered, newest first');
eq(r.targets,{review:4,assignment:4,delegation:4,first_contact:24,resolution:50,closure:24},'targets travel with the figures');
const text=JSON.stringify(r);
eq(/مصنع|PRIVATE-|@yourrest|عضو |complaint-|INV-/.test(text),false,'no customer name, text, member, identifier or reference anywhere');
eq(Object.keys(r).sort(),['byCategory','byChannel','byRegion','bySeverity','byState','cancelled','closed','closureOutcomes','flow','generatedAt','high','month','months','open','openOverTarget','repeatCustomers','resolutionOutcomes','satisfactionRate','satisfied','targets','timing','total'],'only aggregate fields');

// ---- other months and empty months
r=run('owner','2026-08');
eq([r.total,r.cancelled,r.byChannel.map(x=>x.key),r.months],[1,1,['email'],['2026-09','2026-08']],'August has the cancelled one');
r=run('owner','2026-07');
eq([r.total,r.satisfactionRate,r.byCategory,r.byRegion,r.timing.review.n,r.timing.review.median,r.resolutionOutcomes,r.openOverTarget,r.repeatCustomers],[0,null,[],[],0,null,[],0,0],'an empty month is all zeros, not an error');

// ---- each reader sees only what they may already read
r=run('csm');
eq([r.total,r.open,r.closed,r.cancelled,r.satisfactionRate,r.openOverTarget,r.repeatCustomers,r.months],[4,2,2,0,50,2,1,['2026-09','2026-08']],'a customer-service manager: his team\'s complaints (A, B, C, G), not the other manager\'s nor the other branch\'s');
r=run('csm2');
eq([r.total,r.cancelled,r.byChannel.map(x=>x.key),r.months],[1,1,['website'],['2026-09']],'the other customer-service manager: only his team\'s cancelled one');
r=run('csm_b');
eq([r.total,r.open,r.openOverTarget,r.byRegion],[1,1,1,[row('الشرقية',1,1,0,0,null)]],'the other branch\'s manager: the one of his branch');
r=run('sm');
eq([r.total,r.byState,r.months],[5,{closed:2,resolved:1,pending_assignment:1,assigned:1},['2026-09']],'the sales manager: what was routed to him and what any representative holds, not the cancelled one that never reached sales');
r=run('sm2');
eq([r.total,r.byState],[4,{closed:2,resolved:1,assigned:1}],'the other sales manager: the one routed to him and the ones representatives hold (a manager\'s scope is all of sales), not the one still waiting for the first manager');

// ---- the clock is injected
eq(run('owner','2026-09','2026-09-10T09:00:00.000Z').openOverTarget,1,'on Thursday noon only C is past target: B was resolved that morning and F assigned two hours earlier');
eq(run('owner','2026-09','2026-09-08T06:30:00.000Z').openOverTarget,0,'half an hour after C was forwarded every open complaint is within its target');
console.log(JSON.stringify({ok:true,checks,pureFunctions:true,productionDataUsed:false}));
