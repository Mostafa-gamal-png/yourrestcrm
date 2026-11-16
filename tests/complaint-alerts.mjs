// «شكوى تنتظرك» on the server (the owner, 2026-11-16, item 3 of the GSCO list, «ج»; lib/complaint-alerts.ts), pure and without a build:
// whose turn a complaint is at each step (the review by the customer-service manager, the correction and the closure by the registrar, the
// assignment by the sales manager, the delegation by the supervisor, the contact and the resolution by the holder; the administrator only
// when nobody else is there), high importance first, at most 20, the holder's opening, a renewed step, and only the fields a notification
// needs. The same compiled modules as production; made-up members, customers and complaints only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'complaint-alerts-')),seen=new Set();
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
compile('lib/complaint-alerts.ts');compile('lib/complaints.ts');
const A=await import(path.join(out,'lib/complaint-alerts.mjs')),C=await import(path.join(out,'lib/complaints.mjs'));
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual===undefined?undefined:JSON.parse(JSON.stringify(actual)),expected,message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};

// ---- made-up company (Riyadh is UTC+3)
const m=(id,role,supervisorId,extra={})=>({id,userId:'u-'+id,email:id+'@yourrest.org',name:'عضو '+id,role,branch:'الرئيسي',supervisorId,regionScope:'all',active:1,target:0,...extra});
const members=[m('owner','admin'),m('sm','manager'),m('sup','supervisor','sm'),m('rep','rep','sup'),m('rep2','rep','sup'),m('csm','customer_service_manager','sm'),m('cs','customer_service','csm'),m('loner','customer_service',''),m('gone','customer_service','csm',{active:0})];
const customers=['k1','k2','k3','k4','k5','k6','k7','k8','k9'].map(id=>({id,kind:'customer',parentId:null,assignedTo:'rep',branch:'الرئيسي',data:{name:'مصنع '+id,region:'الشرقية',phone:'0500000000',city:'الدمام'},createdAt:'2026-10-01T05:00:00.000Z',updatedAt:'2026-10-01T05:00:00.000Z',version:1}));
const base={kind:'complaint',status:'submitted',registrarId:'cs',serviceManagerId:'csm',salesManagerId:'',supervisorId:'',assigneeId:'',channel:'call',category:'product_quality',severity:'normal',description:'PRIVATE-DESCRIPTION',demand:'PRIVATE-DEMAND',reference:'INV-1',contactName:'PRIVATE-CONTACT',contactPhone:'0599999999',
 submittedAt:'',forwardedAt:'',returnedAt:'',assignedAt:'',delegatedAt:'',reassignedAt:'',rejectedAt:'',reopenedAt:'',resolvedAt:'',closedAt:'',cancelledAt:'',seenAt:'',returnNote:'',assignmentNote:'',rejectReason:'',cancelReason:'',previousAssignees:[],updates:[],notes:['PRIVATE-NOTE'],events:[]};
const T=(day,hour)=>'2026-11-'+String(day).padStart(2,'0')+'T'+String(hour).padStart(2,'0')+':00:00.000Z';
const complaint=(id,createdAt,data)=>{const merged={...base,submittedAt:createdAt,...data};return {id:'complaint-'+id,branch:'الرئيسي',assignedTo:merged.registrarId,data:merged,createdAt,updatedAt:createdAt,version:2};};
const update=at=>({id:'u-'+at,at,by:'rep',channel:'call',date:at.slice(0,10),text:'PRIVATE-UPDATE'});
const sales={salesManagerId:'sm',supervisorId:'sup',assigneeId:'rep'};
const complaints=[
 complaint('review',T(10,5),{customerId:'k1'}),                                                                            // the customer-service manager reviews
 complaint('fix',T(10,6),{customerId:'k2',status:'returned',returnedAt:T(10,7)}),                                         // the registrar corrects
 complaint('assign',T(10,7),{customerId:'k3',status:'pending_assignment',salesManagerId:'sm',forwardedAt:T(10,8),severity:'high',category:'delivery_delay'}), // the sales manager assigns
 complaint('delegate',T(10,8),{customerId:'k4',status:'assigned',salesManagerId:'sm',supervisorId:'sup',assigneeId:'sup',forwardedAt:T(10,9),assignedAt:T(10,10)}), // the supervisor delegates
 complaint('contact',T(10,9),{customerId:'k5',status:'assigned',...sales,forwardedAt:T(10,10),assignedAt:T(10,11)}),      // the representative's first contact, not opened yet
 complaint('opened',T(10,10),{customerId:'k6',status:'assigned',...sales,forwardedAt:T(10,11),assignedAt:T(10,12),seenAt:T(10,13),severity:'high'}), // opened by the holder
 complaint('resolve',T(10,11),{customerId:'k7',status:'assigned',...sales,forwardedAt:T(10,12),assignedAt:T(10,13),seenAt:T(10,14),updates:[update(T(11,5))]}), // contacted, the resolution waits
 complaint('close',T(10,12),{customerId:'k8',status:'resolved',...sales,forwardedAt:T(10,13),assignedAt:T(10,14),updates:[update(T(11,6))],resolvedAt:T(11,7),resolution:{outcome:'solved',note:'PRIVATE',by:'rep',at:T(11,7)}}), // the registrar confirms
 complaint('done',T(9,5),{customerId:'k9',status:'closed',...sales,closedAt:T(10,5),closure:{outcome:'satisfied',note:'',by:'cs',at:T(10,5)}}),
 complaint('cancelled',T(9,6),{customerId:'k9',status:'cancelled',cancelledAt:T(9,7)}),
 complaint('unrouted',T(12,5),{customerId:'k1',registrarId:'loner',serviceManagerId:''})                                  // nobody manages its registrar: the administrator reviews
];
const now='2026-11-16T09:00:00.000Z';
const ask=(id,list=complaints)=>{const c={me:members.find(x=>x.id===id),members,all:customers,complaints:list};return A.complaintAlerts(C.complaintQueue(c,now,Infinity),id,now);};
const brief=feed=>feed.alerts.map(alert=>[alert.id.replace('complaint-',''),alert.awaiting,alert.seen]);

// ---- whose turn, at each step
eq(brief(ask('csm')),[['review','review',false],['unrouted','review',false]],'the customer-service manager: the review (and one whose registrar has no manager, as the complaints page decides)');
eq(brief(ask('cs')),[['close','close',false],['fix','fix',false]],'the registrar: the closure (late now) and the correction, in the complaints page\'s order');
eq(brief(ask('sm')),[['assign','assign',false]],'the sales manager: the assignment');
eq(brief(ask('sup')),[['delegate','delegate',false]],'the supervisor: the delegation of what he holds');
eq(brief(ask('rep')),[['opened','contact',true],['contact','contact',false],['resolve','resolve',true]],'the representative: the contact and the resolution, high importance first; whether he has opened each');
eq(brief(ask('rep2')),[],'another representative: nothing');
eq(brief(ask('owner')),[['unrouted','review',false]],'the administrator: only what nobody else may do (a registrar without a manager)');
eq(brief(ask('loner')),[],'its registrar is not asked to review');
ok(['done','cancelled'].every(id=>!JSON.stringify(ask('cs').alerts).includes('complaint-'+id)),'closed and cancelled complaints are never alerts');
// The registrar left: the closure falls to the manager.
const left=complaints.map(row=>row.id==='complaint-close'?{...row,data:{...row.data,registrarId:'gone'}}:row);
eq(brief(ask('csm',left)),[['review','review',false],['close','close',false],['unrouted','review',false]],'a registrar no longer active: the manager confirms the closure');
// A renewed step (the complaint was returned to the representative): a new `since`, so the phone tells again.
const before=ask('rep').alerts.find(alert=>alert.id==='complaint-resolve').since;
const sentBack=complaints.map(row=>row.id==='complaint-resolve'?{...row,data:{...row.data,rejectedAt:T(12,9),updates:[...row.data.updates]}}:row);
const after=ask('rep',sentBack).alerts.find(alert=>alert.id==='complaint-resolve');
ok(after.since>before&&after.since===T(12,9)&&after.seen===false,'sent back to the representative: a new step, a new since, not yet opened');

// ---- what an alert carries
const one=ask('sm').alerts[0];
eq(one,{id:'complaint-assign',customerName:'مصنع k3',category:'delivery_delay',categoryAr:'التأخر في التسليم',categoryEn:'Delivery delay',severity:'high',awaiting:'assign',seen:false,since:T(10,8)},'exactly what a notification needs');
const feed=ask('rep');
eq([feed.schemaVersion,feed.memberId,feed.generatedAt,feed.count],[1,'rep',now,3],'the answer names the member and the time, and counts what waits');
ok(!/PRIVATE|0599999999|الدمام|INV-1/.test(JSON.stringify([ask('rep'),ask('cs'),ask('csm'),ask('sm'),ask('sup'),ask('owner')])),'no description, demand, contact, phone, city, note, update text or reference leaves');
ok(!JSON.stringify(feed).includes('complaintNumber'),'nor its number');
// The category of a complaint saved with an unknown one is «أخرى».
eq(ask('csm',[complaint('odd',T(10,5),{customerId:'k1',category:'legacy-x'})]).alerts[0].category,'other','an unknown category reads as «أخرى»');

// ---- high importance first, at most twenty, the count is all of them
const many=Array.from({length:25},(_,i)=>complaint('n'+String(i).padStart(2,'0'),T(10,5)+String(i),{customerId:'k1',severity:i%5===4?'high':'normal',submittedAt:'2026-11-1'+(i%9)+'T05:00:00.000Z'}));
const crowded=ask('csm',many);
eq([crowded.count,crowded.alerts.length],[25,20],'twenty at most; the count is every one');
eq(crowded.alerts.slice(0,5).every(alert=>alert.severity==='high'),true,'the five high ones first');
eq(crowded.alerts.slice(5).every(alert=>alert.severity==='normal'),true,'then the others');
const queueOrder=C.complaintQueue({me:members.find(x=>x.id==='csm'),members,all:customers,complaints:many},now,Infinity).filter(entry=>entry.severity==='normal').map(entry=>entry.id).slice(0,15);
eq(crowded.alerts.slice(5).map(alert=>alert.id),queueOrder,'within an importance, the complaints page\'s own order');
eq([A.COMPLAINT_ALERT_LIMIT,A.COMPLAINT_ALERT_STEPS],[20,['review','fix','assign','delegate','contact','resolve','close']],'the limit and the steps the app knows');
// A long name is cut for a notification.
eq(ask('csm',[complaint('long',T(10,5),{customerId:'k1'})].map(row=>row)).alerts[0].customerName,'مصنع k1','a short name as it is');
const longCustomers=[{...customers[0],data:{...customers[0].data,name:'م'.repeat(260)}}];
const longName=A.complaintAlerts(C.complaintQueue({me:members.find(x=>x.id==='csm'),members,all:longCustomers,complaints:[complaint('long',T(10,5),{customerId:'k1'})]},now,Infinity),'csm',now).alerts[0].customerName;
ok(longName.length===200&&longName.endsWith('…'),'a long name is cut to 200');

console.log(JSON.stringify({ok:true,checks,pureFunctions:true,productionDataUsed:false}));
