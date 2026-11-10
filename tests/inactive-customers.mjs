// «عملاء واقفين» (lib/inactive-customers.ts, the owner 2026-11-10, item 3): the alert reuses the customers page's filter «لم يشترِ منذ 60
// يومًا» exactly (inactiveCustomer: status «نشط» and no purchase in 60 days); a representative counts their own assigned customers only;
// the administrator, a sales manager or a supervisor count per member of their team, «عرض بيانات الفريق بالكامل» widening it read only;
// customer service and a member whose «العملاء» screen is hidden get nothing. Synthetic people and customers only; no build, no network.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import assert from 'node:assert/strict';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'inactive-customers-')),seen=new Set();
process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
function compile(relative){
 if(seen.has(relative))return;seen.add(relative);
 const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));
 fs.mkdirSync(path.dirname(dest),{recursive:true});
 let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
  if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
  let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
  if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';
  compile(source);return 'from '+JSON.stringify(path.join(out,source.replace(/\.tsx?$/,'.mjs')));
 });
 fs.writeFileSync(dest,code);
}
compile('lib/inactive-customers.ts');
const {inactiveAlertMode,ownInactiveCount,teamInactiveBreakdown}=await import(path.join(out,'lib/inactive-customers.mjs'));
const {inactiveCustomer}=await import(path.join(out,'lib/customer-last-purchase.mjs'));
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};

const today='2026-11-10',day=back=>new Date(Date.parse(today+'T00:00:00Z')-back*86400000).toISOString().slice(0,10);
const access=(input={})=>({version:1,off:[],hidden:[],viewAll:false,...input});
const member=(id,role,supervisorId='',extra={})=>({id,role,supervisorId,name:'اسم '+id,email:id+'@yourrest.org',branch:'الرئيسي',regionScope:'all',active:1,target:0,access:access(),...extra});
const members=[member('owner','admin'),member('owner2','admin'),member('mgr','manager'),member('sup','supervisor','mgr'),member('sup2','supervisor','mgr'),
 member('rep1','rep','sup'),member('rep2','rep','sup'),member('rep3','rep','sup2'),member('gone','rep','sup',{active:0}),member('cs','customer_service','mgr'),member('csm','customer_service_manager','mgr')];
const who=id=>members.find(m=>m.id===id);
let n=0;
const customer=(assignedTo,data={})=>({id:'c'+(++n),kind:'customer',parentId:null,assignedTo,branch:'الرئيسي',data:{name:'مصنع '+n,customerStatus:'نشط',...data},createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z',version:1});
// For each member: stalled (61 days, never), recent (60 days, today), not «نشط» (خامل, none), a machine of theirs (never a customer).
const customers=[];
const stalled={rep1:3,rep2:1,rep3:2,sup:1,mgr:2,owner:1,owner2:1,gone:2,cs:1};
for(const [id,count] of Object.entries(stalled))for(let i=0;i<count;i++)customers.push(customer(id,i%2?{}:{_lastPurchase:day(61+i)}));
for(const id of Object.keys(stalled)){customers.push(customer(id,{_lastPurchase:day(60)}),customer(id,{_lastPurchase:today}),customer(id,{customerStatus:'خامل'}),customer(id,{customerStatus:''}),customer(id,{customerStatus:'نصف نشط',_lastPurchase:day(300)}));customers.push({...customer(id),kind:'factory'});}
customers.push(customer('nobody-known'),customer(''));

// ---- who gets the alert
eq(['rep1','sup','mgr','owner','cs','csm'].map(id=>inactiveAlertMode(who(id))),['own','team','team','team',null,null],'a representative their own; the administrator, a sales manager and a supervisor their team; customer service nothing');
eq([inactiveAlertMode(null),inactiveAlertMode(undefined)],[null,null],'nobody signed in: nothing');
eq([inactiveAlertMode({...who('rep1'),access:access({hidden:['customer']})}),inactiveAlertMode({...who('sup'),access:access({hidden:['customer']})}),inactiveAlertMode({...who('mgr'),access:access({hidden:['customer']})})],[null,null,null],'«العملاء» hidden («الصلاحيات»): no card, no badge');
eq([inactiveAlertMode({...who('rep1'),access:access({hidden:['map','journeys']})}),inactiveAlertMode({...who('owner'),access:access({hidden:['customer']})})],['own','team'],'another screen hidden changes nothing; nothing is ever hidden from the administrator');

// ---- the rule is the customers page's filter, unchanged
const listed=(id,rows=customers)=>rows.filter(row=>row.kind==='customer'&&row.assignedTo===id&&inactiveCustomer(row,today)).length;
for(const id of ['rep1','rep2','rep3','sup'])eq(ownInactiveCount(who(id),customers,today),listed(id),id+': exactly what «لم يشترِ منذ 60 يومًا» lists for them');
eq([ownInactiveCount(who('rep1'),customers,today),ownInactiveCount(who('rep2'),customers,today)],[3,1],'rep1 three (61 and 62 days, never), rep2 one; 60 days ago, today, «خامل», «نصف نشط», no status and machines never count');
eq(ownInactiveCount(who('rep1'),customers.filter(row=>row.assignedTo!=='rep1'),today),0,'a representative never counts another member\'s customers, even in their region');
eq(ownInactiveCount(who('rep1'),[customer('rep1',{_lastPurchase:day(61)})],day(-1)),1,'the window follows the day passed');
eq(ownInactiveCount(who('rep1'),[customer('rep1',{_lastPurchase:day(60)})],day(-1)),1,'60 days is recent today and stalled tomorrow');

// ---- the team
const breakdown=id=>teamInactiveBreakdown(who(id),members,customers,today);
const pairs=result=>result.rows.map(row=>[row.memberId,row.count]);
eq(pairs(breakdown('sup')),[['rep1',3],['gone',2],['rep2',1],['sup',1]],'a supervisor: their representatives (an inactive one too) and themself, most first; not another supervisor\'s team, not the manager');
eq(breakdown('sup').total,7,'and the total');
eq(breakdown('sup').rows.find(row=>row.memberId==='gone').active,false,'an inactive member is marked');
eq(pairs(breakdown('mgr')),[['rep1',3],['gone',2],['mgr',2],['rep3',2],['rep2',1],['sup',1]],'a sales manager: every supervisor and representative and themself; not the administrators nor customer service');
eq(pairs(breakdown('owner')),[['rep1',3],['gone',2],['mgr',2],['rep3',2],['owner',1],['owner2',1],['rep2',1],['sup',1]],'the administrator: every sales member; never customer service or a customer nobody known holds');
eq(breakdown('owner').total,13,'the administrator\'s total');
const wide=member('sup','supervisor','mgr',{access:access({viewAll:true})});
eq(pairs(teamInactiveBreakdown(wide,members,customers,today)),[['rep1',3],['gone',2],['mgr',2],['rep3',2],['owner',1],['owner2',1],['rep2',1],['sup',1]],'«عرض بيانات الفريق بالكامل»: the supervisor reads the whole sales team, as everywhere else');
eq(pairs(teamInactiveBreakdown(member('rep1','rep','sup',{access:access({viewAll:true})}),members,customers,today)),[['rep1',3]],'the switch never widens a representative');
eq(teamInactiveBreakdown(who('sup'),members,[],today),{total:0,rows:[]},'nothing stalled: no rows (the card is not drawn)');
const ties=teamInactiveBreakdown(who('sup'),members,[customer('rep2'),customer('rep1')],today);
eq(ties.rows.map(row=>row.memberId),['rep1','rep2'],'equal counts by name');

console.log(JSON.stringify({ok:true,checks,syntheticFixtures:true}));
