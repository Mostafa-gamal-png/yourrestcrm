// The monthly customer-service report: counts by channel and state, stage timings in working hours against their
// targets, win rate and loss reasons, and who may read it. Pure functions over an in-memory context; the same compiled
// domain modules as production. No database, no network, no production data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'service-report-')),seen=new Set();
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
compile('lib/service-report.ts');
const report=await import(path.join(out,'lib/service-report.mjs'));
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual===undefined?undefined:JSON.parse(JSON.stringify(actual)),expected,message);checks++;};

// ---- who may read it
eq(['admin','manager','customer_service_manager','supervisor','rep','customer_service','unknown'].map(report.serviceReportAllowed),[true,true,true,false,false,false,false],'administrators, sales managers and customer-service managers only');
eq(['2026-09','2026-12','1999-01'].every(v=>report.REPORT_MONTH.test(v)),true,'valid months');
eq(['2026-13','2026-00','26-09','2026-9','2026-09-01','','x'].some(v=>report.REPORT_MONTH.test(v)),false,'invalid months');

// ---- fixtures (Riyadh is UTC+3; 2026-09-06 is a Sunday, 2026-09-07 Monday, 2026-09-09 Wednesday)
const m=(id,role,supervisorId,regionScope='all')=>({id,userId:'u-'+id,email:id+'@yourrest.org',name:id,role,branch:'الرئيسي',supervisorId,regionScope,active:1,target:0});
const members=[m('owner','admin'),m('sm','manager'),m('sup','supervisor','sm'),m('rep','rep','sup'),m('csm','customer_service_manager','sm'),m('cs','customer_service','csm'),m('csm2','customer_service_manager','sm'),m('cs2','customer_service','csm2')];
const customer=id=>({id,kind:'customer',parentId:null,assignedTo:'rep',branch:'الرئيسي',data:{name:'مصنع '+id,region:'الشرقية',phone:'0500000000'},createdAt:'2026-08-01T05:00:00.000Z',updatedAt:'2026-08-01T05:00:00.000Z',version:1});
const contact=(id,caseId,customerId,createdAt,data)=>({id,kind:'activity',parentId:customerId,assignedTo:'rep',branch:'الرئيسي',data:{type:'call',date:createdAt.slice(0,10),result:'تم',salesStage:'new',serviceCaseId:caseId,performedBy:'rep',responsibleId:'rep',recordedByEmail:'rep@yourrest.org',...data},createdAt,updatedAt:createdAt,version:1});
const kase=(id,customerId,status,fields,data)=>({id,customerId,status,creatorId:'cs',serviceManagerId:'csm',salesManagerId:'sm',assignedTo:null,supervisorId:null,...fields,data:{source:'call',products:['خدمات صيانة'],strength:'strong',needs:'x',nextAction:'y',nextDate:'2026-10-20',participants:['cs','csm'],...data},createdAt:'2026-09-06T05:00:00.000Z',updatedAt:'2026-09-06T05:00:00.000Z',version:2,...fields.__top});
const withTop=(item,top)=>({...item,...top});
const cases=[
 // A: call, approved after 1h, assigned after 2 more, first contact 1h later, won later
 withTop(kase('A','c-A','assigned',{assignedTo:'rep',supervisorId:'sup'},{source:'call',approvedAt:'2026-09-06T06:00:00.000Z',assignedAt:'2026-09-06T08:00:00.000Z'}),{createdAt:'2026-09-06T05:00:00.000Z'}),
 // B: whatsapp, approval took 6h (late), assigned 1h later, first contact Wednesday 08:00 (13 working hours), lost
 withTop(kase('B','c-B','assigned',{assignedTo:'rep',supervisorId:'sup'},{source:'whatsapp',approvedAt:'2026-09-07T11:00:00.000Z',assignedAt:'2026-09-07T12:00:00.000Z'}),{createdAt:'2026-09-07T05:00:00.000Z'}),
 // C: call, approved after 1h, still waiting for the manager
 withTop(kase('C','c-C','pending_assignment',{},{source:'call',approvedAt:'2026-09-08T06:00:00.000Z'}),{createdAt:'2026-09-08T05:00:00.000Z'}),
 // D: created in August (another month)
 withTop(kase('D','c-D','pending_approval',{salesManagerId:null},{source:'email'}),{createdAt:'2026-08-31T05:00:00.000Z'}),
 // E: website, still waiting for approval since 2026-09-09
 withTop(kase('E','c-E','pending_approval',{salesManagerId:null},{source:'website'}),{createdAt:'2026-09-09T05:00:00.000Z'}),
 // F: another service manager's case: invisible to csm
 withTop(kase('F','c-F','pending_approval',{creatorId:'cs2',serviceManagerId:'csm2',salesManagerId:null},{source:'social',participants:['cs2','csm2']}),{createdAt:'2026-09-10T05:00:00.000Z'})
];
const all=[...['A','B','C','D','E','F'].map(x=>customer('c-'+x)),
 contact('a1','A','c-A','2026-09-06T09:00:00.000Z',{salesStage:'new'}),contact('a2','A','c-A','2026-09-10T07:00:00.000Z',{salesStage:'won',date:'2026-09-10'}),
 contact('b1','B','c-B','2026-09-09T05:00:00.000Z',{salesStage:'lost',lossReason:'السعر أعلى من المنافس'})];
const ctx=id=>({me:members.find(x=>x.id===id),members,all,serviceCases:cases});
const run=(id,month='2026-09',now='2026-10-12T12:00:00.000Z')=>report.serviceReport(ctx(id),month,now);

// ---- the administrator sees every case of the month
let r=run('owner');
eq([r.total,r.open,r.won,r.lost,r.winRate],[5,3,1,1,50],'September: five cases, three open, one won, one lost, half of the closed ones won');
eq(r.byState,{won:1,lost:1,pending_assignment:1,pending_approval:2},'by current state');
eq(r.bySource.map(s=>[s.source,s.total,s.won,s.lost,s.open,s.winRate]),[['call',2,1,0,1,100],['social',1,0,0,1,null],['website',1,0,0,1,null],['whatsapp',1,0,1,0,0]],'by channel, busiest first; the win rate only where a case closed');
eq(r.timing.approval,{n:3,median:1,average:2.67,target:4,overTarget:1},'approval: 1, 6 and 1 working hours; one over the 4-hour target');
eq(r.timing.assignment,{n:2,median:1.5,average:1.5,target:4,overTarget:0},'assignment: 2 and 1 hours');
eq(r.timing.firstContact,{n:2,median:7,average:7,target:24,overTarget:0},'first contact after assignment: 1 hour and 13 working hours (the night and the Tuesday count only inside working hours)');
eq(r.timing.totalToFirstContact,{n:2,median:12,average:12,target:null,overTarget:0},'registration to first contact: 4 and 20 hours');
eq(r.lossReasons,[{reason:'السعر أعلى من المنافس',count:1}],'loss reasons come from the closing contact');
eq(r.openOverTarget,3,'open cases already past their stage target: C waiting for assignment, E and F waiting for approval');
eq(r.months,['2026-09','2026-08'],'months offered, newest first');
eq(r.targets,{approval:4,assignment:4,delegation:4,first_contact:24},'targets reported with the numbers');
eq(JSON.stringify(r).includes('مصنع'),false,'no customer name anywhere');
eq(Object.keys(r).sort(),['byState','bySource','generatedAt','lossReasons','month','months','open','openOverTarget','lost','targets','timing','total','winRate','won'].sort(),'only aggregate fields');

// ---- other months and empty months
eq(run('owner','2026-08').total,1,'August has one case');
eq(run('owner','2026-08').bySource.map(s=>s.source),['email'],'and its channel');
r=run('owner','2026-07');
eq([r.total,r.winRate,r.bySource,r.timing.approval.n,r.timing.approval.median,r.lossReasons],[0,null,[],0,null,[]],'an empty month is all zeros, not an error');

// ---- each reader sees only what they may already read
r=run('sm');
eq([r.total,r.byState],[3,{won:1,lost:1,pending_assignment:1}],'the manager sees the cases routed to him or held by sales, not the ones still waiting for approval');
r=run('csm');
eq([r.total,r.byState],[4,{won:1,lost:1,pending_assignment:1,pending_approval:1}],'a customer-service manager sees his own team\'s cases');
eq(r.bySource.some(s=>s.source==='social'),false,'and not another manager\'s team');
r=run('csm2');
eq([r.total,r.bySource.map(s=>s.source)],[1,['social']],'the other manager sees only his');

// ---- the clock is injected
eq(run('owner','2026-09','2026-09-09T08:00:00.000Z').openOverTarget,1,'on the afternoon of the 9th only C is past target (E was registered that morning)');
eq(run('owner','2026-09','2026-09-08T07:00:00.000Z').openOverTarget,0,'an hour after C was approved every open case is within its target');
console.log(JSON.stringify({ok:true,checks,pureFunctions:true,productionDataUsed:false}));
