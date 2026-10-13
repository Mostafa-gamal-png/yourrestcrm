// Customer-service assistance, as pure functions over an in-memory context built from the same compiled domain modules as
// production: who may ask, who may read and act, how a request is routed to the customer-service member of a region, when it is
// late (working hours), and which visits count as missed and for whom. No database, no network, no production data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'support-')),seen=new Set();
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
compile('lib/support.ts');compile('lib/customer-visits.ts');
const S=await import(path.join(out,'lib/support.mjs')),V=await import(path.join(out,'lib/customer-visits.mjs'));
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual===undefined?undefined:JSON.parse(JSON.stringify(actual)),expected,message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};

// ---- calendar helpers and the phone links
eq([S.addDays('2026-10-10',2),S.addDays('2026-12-31',1),S.addDays('2026-03-01',-1),S.addDays('nonsense',1),S.addDays('2026-10-10',0)],['2026-10-12','2027-01-01','2026-02-28','','2026-10-10'],'adding days to a calendar date, across months and years');
eq([S.daysBetween('2026-10-10','2026-10-14'),S.daysBetween('2026-10-14','2026-10-10'),S.daysBetween('x','2026-10-10')],[4,-4,0],'days between two calendar dates');
eq(S.riyadhDayStart('2026-10-12'),'2026-10-11T21:00:00.000Z','a Riyadh day begins at 21:00 UTC the evening before');
eq([S.isNegativeResult({result:'سلبية'}),S.isNegativeResult({outcome:'noresponse'}),S.isNegativeResult({result:'متابعة العميل'}),S.isNegativeResult({result:'تم الشراء'}),S.isNegativeResult({}),S.isNegativeResult({result:'لم تنجح المتابعة'})],[true,true,false,false,false,false],'only the recorded negative result (or an old "no contact" outcome) counts');
eq([S.contactLinks('0551234567'),S.contactLinks('٠٥٥١٢٣٤٥٦٧'),S.contactLinks('+971501234567'),S.contactLinks('00201001234567'),S.contactLinks('0138334444'),S.contactLinks('12'),S.contactLinks(''),S.contactLinks(undefined),S.contactLinks('966551234567')],[
 {tel:'tel:0551234567',whatsapp:'https://wa.me/966551234567'},{tel:'tel:0551234567',whatsapp:'https://wa.me/966551234567'},{tel:'tel:+971501234567',whatsapp:'https://wa.me/971501234567'},{tel:'tel:00201001234567',whatsapp:'https://wa.me/201001234567'},{tel:'tel:0138334444',whatsapp:''},{tel:'',whatsapp:''},{tel:'',whatsapp:''},{tel:'',whatsapp:''},{tel:'tel:966551234567',whatsapp:'https://wa.me/966551234567'}
],'dial link for any number; WhatsApp only for a Saudi mobile or a number with its country code; Arabic digits are read');

// ---- a synthetic company: two branches, three regions, customer service split by region
const m=(id,role,supervisorId,regionScope='all',branch='الرئيسي',active=1)=>({id,userId:'u-'+id,email:id+'@yourrest.org',name:id,role,branch,supervisorId,regionScope,active,target:0});
const members=[m('owner','admin'),m('sm','manager'),m('sm2','manager'),m('sup','supervisor','sm'),m('rep','rep','sup'),m('rep2','rep','sup'),m('outside','rep','other'),
 m('csm','customer_service_manager','sm'),m('cs_east','customer_service','csm','eastern'),m('cs_west','customer_service','csm','western'),m('cs_all','customer_service','csm','all'),m('cs_off','customer_service','csm','central','الرئيسي',0),
 m('csm_b','customer_service_manager','sm','all','فرع آخر'),m('cs_b','customer_service','csm_b','all','فرع آخر')];
const region={east:'الشرقية',west:'الغربية',central:'الوسطى'};
const customer=(id,assignedTo,regionName,branch='الرئيسي')=>({id,kind:'customer',parentId:null,assignedTo,branch,data:{name:'مصنع '+id,region:regionName,phone:'05512345'+id.slice(-2).padStart(2,'0'),city:'مدينة '+id},createdAt:'2026-08-01T05:00:00.000Z',updatedAt:'2026-08-01T05:00:00.000Z',version:4});
const now='2026-10-14T09:00:00.000Z'; // Wednesday 12:00 in Riyadh
let serial=0;
const visit=(customerId,author,fields={})=>{serial++;const at=fields.startedAt||'2026-10-0'+(1+serial%8)+'T07:00:00.000Z';return {id:'v-'+serial,kind:'activity',parentId:customerId,assignedTo:author,branch:'الرئيسي',data:{type:'visit',date:at.slice(0,10),startedAt:at,result:'سلبية',summary:'PRIVATE-VISIT-SUMMARY',notes:'PRIVATE-VISIT-NOTES',salesStage:'new',nextAction:'زيارة متابعة',nextDate:'2026-10-10',visitWorkflow:'customer-v1',performedBy:author,responsibleId:author,...fields},createdAt:at,updatedAt:at,version:1};};
const customers=[customer('c-1','rep',region.east),customer('c-2','rep2',region.west),customer('c-3','outside',region.east),customer('c-4','rep',region.central),customer('c-5','rep',region.east,'فرع آخر'),
 customer('c-6','rep',region.east),customer('c-7','rep',region.east),customer('c-8','rep',region.east),customer('c-9','rep',region.east),customer('c-10','rep',region.east),customer('c-11','rep',region.east,'فرع ثالث'),
 customer('c-12','rep',region.east),customer('c-13','rep',region.east),customer('c-14','rep',region.east),customer('c-15','rep',region.east),customer('c-16','rep',region.central),customer('c-17','rep',region.east,'فرع آخر'),customer('c-18','rep',region.east,'فرع ثالث')];
const at=(date,time='07:00:00.000Z')=>date+'T'+time;
const records=[
 ...customers,
 visit('c-1','rep',{startedAt:at('2026-10-06'),nextDate:'2026-10-10'}),                                    // missed: negative, due Oct 10, two days passed
 visit('c-2','rep2',{startedAt:at('2026-10-06'),result:'متابعة العميل',nextDate:'2026-10-05'}),             // overdue but not negative
 visit('c-3','outside',{startedAt:at('2026-10-06'),nextDate:'2026-10-13'}),                                 // negative, only one day past: not yet
 visit('c-4','rep',{startedAt:at('2026-09-01'),nextDate:'2026-09-13'}),                                     // oldest day still routed (window ends the day before Oct 15)
 visit('c-5','rep',{startedAt:at('2026-10-06'),nextDate:'2026-10-09'}),                                     // missed, but has an open request
 visit('c-6','rep',{startedAt:at('2026-10-03'),nextDate:'2026-10-05'}),visit('c-6','rep',{startedAt:at('2026-10-08'),visitWorkflow:'followup-v1',type:'call',result:'تم الاتصال وأُرسل العرض'}), // later follow-up closes it
 visit('c-7','rep',{startedAt:at('2026-10-06'),nextDate:'2026-10-05',salesStage:'lost'}),                    // lost: closed
 visit('c-8','rep',{startedAt:at('2026-10-03'),nextDate:'2026-10-05'}),visit('c-8','rep2',{startedAt:at('2026-10-09'),result:'تم أخذ موعد',nextDate:'2026-10-20'}), // later contact by another member
 visit('c-9','rep',{startedAt:at('2026-10-05'),nextDate:'2026-10-06'}),                                     // missed, but has an open request
 visit('c-10','rep',{startedAt:at('2026-10-05'),nextDate:'2026-10-06'}),                                    // missed, plan already handled
 visit('c-11','rep',{startedAt:at('2026-10-05'),nextDate:'2026-10-06'}),                                    // missed, but has an open request
 visit('c-12','rep',{startedAt:at('2026-10-02'),nextDate:'2026-10-12'}),                                    // exactly two days: missed today
 visit('c-13','rep',{startedAt:at('2026-10-05'),nextDate:'2026-10-06',followupStatus:'closed'}),            // follow-up closed by hand
 visit('c-14','rep',{startedAt:at('2026-10-05'),nextDate:''}),                                              // negative, no follow-up date
 visit('c-15','rep',{startedAt:at('2026-10-05'),result:'',outcome:'noresponse',nextDate:'2026-10-06'}),     // an old "no contact" outcome counts as negative
 visit('c-17','rep',{startedAt:at('2026-10-06'),nextDate:'2026-10-09'}),                                    // missed, other branch
 visit('c-18','rep',{startedAt:at('2026-10-05'),nextDate:'2026-10-06'})                                     // missed, branch without customer service
];
const row=(id,customerId,status,fields={},data={})=>({id,branch:customers.find(c=>c.id===customerId)?.branch||'الرئيسي',assignedTo:fields.requestedBy||'rep',createdAt:fields.createdAt||'2026-10-14T05:30:00.000Z',updatedAt:fields.updatedAt||fields.createdAt||'2026-10-14T05:30:00.000Z',version:fields.version||1,
 data:{kind:'support',customerId,origin:'rep',status,requestedBy:'rep',requestedAt:fields.createdAt||'2026-10-14T05:30:00.000Z',repId:'rep',note:'يرجى التواصل مع العميل',channel:'any',handlerId:'',handlerAt:'',handlerBy:'',...data}});
const support=[
 row('s-1','c-1','open',{createdAt:'2026-10-14T05:00:00.000Z'},{handlerId:'cs_east',handlerAt:'2026-10-14T05:00:00.000Z',handlerBy:'rep'}), // routed at once to the eastern representative; 4 working hours exactly
 row('s-2','c-3','open',{createdAt:'2026-10-13T09:00:00.000Z',requestedBy:'outside'},{requestedBy:'outside',repId:'outside'}),         // waiting since Tuesday 12:00: 10 working hours
 row('s-3','c-16','open',{createdAt:'2026-10-14T08:00:00.000Z'},{}),                                                                 // central: nobody is named for it, so it is shared
 row('s-4','c-11','open',{createdAt:'2026-10-14T08:00:00.000Z'},{}),                                                                 // a branch with no customer service at all
 row('s-5','c-2','done',{createdAt:'2026-10-12T06:00:00.000Z',updatedAt:'2026-10-13T08:00:00.000Z',requestedBy:'rep2'},{requestedBy:'rep2',repId:'rep2',handlerId:'cs_west',result:{outcome:'reached_interested',note:'العميل مهتم ويطلب عرضًا',nextDate:'',by:'cs_west',at:'2026-10-13T08:00:00.000Z'}}), // answered, not yet opened
 row('s-6','c-2','done',{createdAt:'2026-10-05T06:00:00.000Z',updatedAt:'2026-10-06T08:00:00.000Z',requestedBy:'rep2'},{requestedBy:'rep2',repId:'rep2',handlerId:'cs_west',answerSeenAt:'2026-10-06T09:00:00.000Z',answerSeenBy:'rep2',result:{outcome:'no_answer',note:'لم يرد',nextDate:'',by:'cs_west',at:'2026-10-06T08:00:00.000Z'}}), // answered and opened
 row('s-7','c-2','cancelled',{createdAt:'2026-10-07T06:00:00.000Z',updatedAt:'2026-10-07T07:00:00.000Z',requestedBy:'rep2'},{requestedBy:'rep2',repId:'rep2',cancelledBy:'rep2',cancelledAt:'2026-10-07T07:00:00.000Z',cancelReason:'تم الحل'}),
 row('s-8','c-2','done',{createdAt:'2026-08-01T06:00:00.000Z',updatedAt:'2026-08-02T08:00:00.000Z',requestedBy:'rep2'},{requestedBy:'rep2',repId:'rep2',handlerId:'cs_west',result:{outcome:'other',note:'قديم',nextDate:'',by:'cs_west',at:'2026-08-02T08:00:00.000Z'}}), // older than the history window
 row('s-9','c-9','open',{createdAt:'2026-10-14T06:00:00.000Z'},{handlerId:'cs_all',handlerAt:'2026-10-14T06:00:00.000Z',handlerBy:'rep'}),
 row('s-10','c-10','done',{createdAt:'2026-10-13T06:00:00.000Z',updatedAt:'2026-10-13T08:00:00.000Z',requestedBy:'cs_all'},{origin:'missed_visit',requestedBy:'cs_all',handlerId:'cs_all',plan:{visitId:records.find(r=>r.parentId==='c-10'&&r.kind==='activity').id,visitDate:'2026-10-05',result:'سلبية',nextAction:'زيارة متابعة',nextDate:'2026-10-06'},result:{outcome:'no_answer',note:'لم يرد',nextDate:'',by:'cs_all',at:'2026-10-13T08:00:00.000Z'}}),
 row('s-11','c-5','open',{createdAt:'2026-10-14T08:30:00.000Z'},{}),                                                                   // the other branch
 row('s-12','c-12','done',{createdAt:'2026-08-10T06:00:00.000Z',updatedAt:'2026-08-11T08:00:00.000Z',requestedBy:'cs_all'},{origin:'missed_visit',requestedBy:'cs_all',handlerId:'cs_all',plan:{visitId:'v-old',visitDate:'2026-08-01',result:'سلبية',nextAction:'x',nextDate:'2026-08-05'},result:{outcome:'other',note:'قديم',nextDate:'',by:'cs_all',at:'2026-08-11T08:00:00.000Z'}}) // an older plan of c-12, finished long ago
];
const scoped=(id,overrides={})=>{const me=members.find(x=>x.id===id),team=new Set(members.filter(x=>x.id===me.id||me.role==='admin'||me.role==='manager'&&['supervisor','rep'].includes(x.role)||me.role==='supervisor'&&x.role==='rep'&&x.supervisorId===me.id).map(x=>x.id));
 const visible=me.role==='admin'?records:['customer_service','customer_service_manager'].includes(me.role)?[]:records.filter(r=>r.kind==='customer'||team.has(r.assignedTo));
 return {me,members,all:records,visible,support,...overrides};};
const queue=(id,when=now)=>S.supportQueue(scoped(id),when);
const ids=list=>list.map(e=>e.id);
const byId=(list,id)=>list.find(e=>e.id===id);

// ---- the plan source slice equals the plan source over everything, for every customer
{
 const groups=S.groupByCustomer(records);
 for(const c of customers)eq(V.customerPlanSource(c.id,groups.get(c.id)||[c])?.id,V.customerPlanSource(c.id,records)?.id,'the plan of '+c.id+' is the same over its own slice');
 // a seeded random company: machines, requests, quotes, visits, follow-ups, in any order
 let seed=20261014;const random=()=>{seed=(seed*1664525+1013904223)%4294967296;return seed/4294967296;},pick=list=>list[Math.floor(random()*list.length)];
 const rows=[];let n=0;
 for(let i=0;i<120;i++){
  const cid='r-'+i;rows.push(customer(cid,'rep',region.east));
  const machine=random()<0.4?'m-'+i:'';if(machine)rows.push({id:machine,kind:'factory',parentId:cid,assignedTo:'rep',branch:'الرئيسي',data:{name:'ماكينة'},createdAt:'2026-08-02T05:00:00.000Z',updatedAt:'2026-08-02T05:00:00.000Z',version:1});
  const request=random()<0.5?'q-'+i:'';if(request)rows.push({id:request,kind:'opportunity',parentId:machine||cid,assignedTo:'rep',branch:'الرئيسي',data:{hasRequest:true,stage:pick(['new','quoted','won','lost']),nextDate:'2026-10-0'+(1+Math.floor(random()*8)),nextAction:'x'},createdAt:'2026-09-01T05:00:00.000Z',updatedAt:'2026-09-'+String(1+Math.floor(random()*28)).padStart(2,'0')+'T05:00:00.000Z',version:1});
  for(let j=0,count=Math.floor(random()*4);j<count;j++){const date='2026-09-'+String(1+Math.floor(random()*28)).padStart(2,'0');rows.push({id:'a-'+(n++),kind:'activity',parentId:pick([cid,machine||cid,request||cid]),assignedTo:'rep',branch:'الرئيسي',data:{type:'visit',date,startedAt:date+'T07:00:00.000Z',result:pick(['سلبية','تم أخذ موعد','متابعة العميل']),salesStage:pick(['new','quoted','won','lost','new']),nextDate:'2026-10-0'+(1+Math.floor(random()*8)),nextAction:'x',visitWorkflow:pick(['customer-v1','followup-v1','service-intake-v1']),requestId:request},createdAt:date+'T07:00:00.000Z',updatedAt:date+'T07:00:00.000Z',version:1});}
 }
 const slices=S.groupByCustomer(rows);let compared=0;
 for(const c of rows.filter(r=>r.kind==='customer')){eq(V.customerPlanSource(c.id,slices.get(c.id)||[c])?.id,V.customerPlanSource(c.id,rows)?.id,'random company: the plan of '+c.id);compared++;}
 ok(compared===120,'all 120 random customers compared');
}

// ---- who may ask for help
{
 const asks=(id,customerId,visible)=>S.canRequestSupport(customers.find(c=>c.id===customerId),{...scoped(id),...(visible?{visible}:{})});
 eq([asks('rep','c-1'),asks('rep','c-2'),asks('rep','c-3'),asks('rep','c-4')],[true,false,false,true],'a representative asks for the customers assigned to them only');
 eq(asks('rep','c-2',[...scoped('rep').visible,records.find(r=>r.kind==='activity'&&r.parentId==='c-2')||visit('c-2','rep')]),true,'or for a customer they have a visit record under');
 eq([asks('sup','c-1'),asks('sup','c-3'),asks('sup','c-2')],[true,false,true],'a supervisor asks for their team\'s customers');
 eq([asks('sm','c-3'),asks('sm2','c-1'),asks('owner','c-1'),asks('owner','c-5')],[true,true,true,true],'managers ask for any sales customer, the administrator for any customer');
 eq([asks('cs_east','c-1'),asks('csm','c-1'),asks('cs_all','c-4')],[false,false,false],'customer service does not ask itself for help');
 const narrow=scoped('rep',{me:{...members.find(x=>x.id==='rep'),regionScope:'western'}});
 eq(S.canRequestSupport(customers[0],narrow),false,'nor outside the representative\'s own region');
 eq(S.canRequestSupport(undefined,scoped('rep')),false,'nor for a customer that does not exist');
}

// ---- routing: the region's own representative, else the shared pool, else nobody
{
 const staff=(id)=>{const s=S.supportStaff(customers.find(c=>c.id===id),members);return [s.routedTo?.id||'',s.reps.map(x=>x.id),s.leads.map(x=>x.id)];};
 eq(staff('c-1'),['cs_east',['cs_east','cs_all'],['csm']],'an eastern customer goes to the representative assigned to the east; the one assigned to all regions can cover');
 eq(staff('c-2'),['cs_west',['cs_west','cs_all'],['csm']],'a western customer to the western one');
 eq(staff('c-4'),['',['cs_all'],['csm']],'a central customer: the inactive central representative does not count, the shared one takes it');
 eq(staff('c-5'),['',['cs_b'],['csm_b']],'another branch has its own customer service');
 eq(staff('c-11'),['',[],[]],'a branch with no customer service has nobody');
 const two=[...members,m('cs_east2','customer_service','csm','eastern')];
 eq(S.supportStaff(customers[0],two).routedTo,undefined,'two named for the same region: nobody is auto-routed, they share it');
}

// ---- reading: who sees which request
{
 const seeIds=(id)=>ids(queue(id)).sort();
 const everything=['s-1','s-10','s-11','s-2','s-3','s-4','s-5','s-6','s-7','s-9'];
 eq(seeIds('owner'),everything,'the administrator sees every request except those past the history window');
 eq(seeIds('rep'),['s-1','s-10','s-11','s-3','s-4','s-9'],'a representative sees what concerns their own customers');
 eq(seeIds('rep2'),['s-5','s-6','s-7'],'another representative only their own');
 eq(seeIds('outside'),['s-2'],'a representative outside the chain sees their own request alone');
 eq(seeIds('sup'),['s-1','s-10','s-11','s-3','s-4','s-5','s-6','s-7','s-9'],'a supervisor sees their team\'s, not another team\'s');
 eq(seeIds('sm'),everything,'a sales manager sees the whole sales team\'s requests');
 eq(seeIds('cs_east'),['s-1','s-10','s-2','s-9'],'the eastern representative sees the eastern customers of their branch');
 eq(seeIds('cs_west'),['s-5','s-6','s-7'],'the western one the western');
 eq(seeIds('cs_all'),['s-1','s-10','s-2','s-3','s-5','s-6','s-7','s-9'],'the shared representative sees every region of the branch, not another branch');
 eq(seeIds('csm'),['s-1','s-10','s-2','s-3','s-5','s-6','s-7','s-9'],'the manager sees the whole branch');
 eq(seeIds('cs_b'),['s-11'],'another branch sees its own');
 eq(seeIds('csm_b'),['s-11'],'and its manager');
 eq(ids(S.supportQueue(scoped('csm',{me:{...members.find(x=>x.id==='csm'),regionScope:'eastern'}}),now)).sort(),['s-1','s-10','s-2','s-9'],'a manager limited to one region sees that region only');
 eq(S.supportQueue({...scoped('rep'),support:[]},now),[],'no requests, no entries');
 eq(S.supportQueue({...scoped('rep'),all:records.filter(r=>r.id!=='c-1')},now).map(e=>e.id).includes('s-1'),false,'a request whose customer is gone is not shown');
 const stranger=S.supportQueue(scoped('owner',{me:{...members.find(x=>x.id==='owner'),role:'unknown'}}),now);
 eq(stranger,[],'an unknown role sees nothing');
}

// ---- what each reader may do with each request
{
 const perm=(id,requestId)=>{const e=byId(queue(id),requestId);return e&&['take','assign','result','cancel','seen'].map(key=>e.permissions[key]);};
 //            take   assign result cancel seen
 eq(perm('rep','s-1'),[false,false,false,true,false],'the asker may only cancel an open request');
 eq(perm('sup','s-1'),[false,false,false,true,false],'so may their supervisor');
 eq(perm('sm','s-1'),[false,false,false,true,false],'and the sales manager');
 eq(perm('cs_east','s-1'),[false,false,true,false,false],'the representative it was routed to records the result; nobody else takes it');
 eq(perm('cs_all','s-1'),[false,false,false,false,false],'a colleague who is not the holder does nothing to it');
 eq(perm('csm','s-1'),[false,true,true,false,false],'the manager may re-assign it or record the result, not cancel a sales request');
 eq(perm('owner','s-1'),[false,true,true,true,false],'the administrator may do all but take what is already held');
 eq(perm('cs_east','s-2'),[true,false,true,false,false],'a waiting request in their region can be taken, or answered directly');
 eq(perm('cs_all','s-2'),[true,false,true,false,false],'also by the representative assigned to every region');
 eq(perm('csm','s-2'),[true,true,true,false,false],'the manager takes or assigns');
 eq(perm('outside','s-2'),[false,false,false,true,false],'its asker may cancel');
 eq(perm('sup','s-2'),undefined,'a supervisor outside the chain cannot even see it');
 eq(perm('sm','s-2'),[false,false,false,true,false],'a sales manager can cancel any sales representative\'s request');
 eq(perm('rep2','s-5'),[false,false,false,false,true],'the asker opens the answer once');
 eq(perm('rep2','s-6'),[false,false,false,false,false],'an answer already opened is not offered again');
 eq(perm('sup','s-5'),[false,false,false,false,false],'a supervisor reads an answer without owning it');
 eq(perm('rep','s-10'),[false,false,false,false,true],'the representative whose visit was missed opens the contact that followed');
 eq(perm('cs_west','s-5'),[false,false,false,false,false],'a finished request is closed for customer service');
 eq(perm('csm','s-10'),[false,false,false,false,false],'and for the manager');
}

// ---- time: the clock is working hours from the moment of the request; late only for what still waits
{
 const e=id=>byId(queue('owner'),id);
 eq([e('s-1').stageHours,e('s-1').late,e('s-1').targetHours],[4,false,4],'exactly four working hours is not yet late');
 eq([e('s-2').stageHours,e('s-2').late],[10,true],'Tuesday noon to Wednesday noon is ten working hours: late');
 eq([e('s-3').stageHours,e('s-9').stageHours],[1,3],'recent requests are within target');
 eq([e('s-5').stageHours,e('s-5').late,e('s-7').late],[0,false,false],'a finished or cancelled request has no clock');
 const saturday=S.supportQueue(scoped('owner'),'2026-10-17T08:00:00.000Z'); // Saturday 11:00; Friday adds nothing
 eq([byId(saturday,'s-2').stageHours,byId(saturday,'s-1').stageHours,byId(saturday,'s-1').late],[29,23,true],'working hours skip Friday');
 const later=S.supportQueue(scoped('owner'),'2026-10-14T10:00:00.000Z');
 eq([byId(later,'s-1').stageHours,byId(later,'s-1').late],[5,true],'an hour on it is late');
}

// ---- what waits for whom, and the order of the list
{
 const waits=(id)=>queue(id).filter(e=>e.awaiting).map(e=>[e.id,e.awaiting]);
 eq(waits('cs_east'),[['s-2','take'],['s-1','contact']],'the eastern representative: a request to take (late first) and the one routed to them');
 eq(waits('cs_all'),[['s-2','take'],['s-9','contact'],['s-3','take']],'the shared representative: what to take and what they hold');
 eq(waits('csm'),[['s-2','assign']],'the manager waits for the late request, not for the ones within target');
 eq(waits('owner'),[['s-2','assign'],['s-4','assign']],'the administrator also for the request nobody can take (a branch without customer service)');
 eq(waits('rep'),[['s-10','answer']],'a representative waits for the answers they have not opened');
 eq(waits('rep2'),[['s-5','answer']],'another for theirs');
 eq(waits('sup'),[],'a supervisor waits for nothing');
 eq(waits('cs_b'),[['s-11','take']],'another branch takes its own');
 eq(byId(queue('owner'),'s-4').unrouted,true,'a branch with nobody to answer is flagged');
 eq(ids(queue('owner')),['s-2','s-4','s-1','s-9','s-3','s-11','s-10','s-5','s-7','s-6'],'late and waiting first, then the oldest open ones, then the newest answers; finished ones last');
 eq(byId(queue('csm'),'s-2').candidates.map(x=>x.id).sort(),['cs_all','cs_east','csm'],'the manager may assign to the region\'s representatives or take it himself');
 eq(byId(queue('csm'),'s-1').candidates.map(x=>x.id).sort(),['cs_all','csm'],'never to the one who already holds it');
 eq(byId(queue('cs_east'),'s-2').candidates,[],'a representative has no one to assign to');
 eq(byId(queue('rep'),'s-1').candidates,[],'nor a sales member');
 const entry=byId(queue('owner'),'s-1');
 eq([entry.requestedByName,entry.repName,entry.handlerName,entry.state,entry.origin,entry.customerName,entry.customerRegion],['rep','rep','cs_east','in_progress','rep','مصنع c-1','الشرقية'],'names and state are filled in');
 eq(byId(queue('owner'),'s-5').result,{outcome:'reached_interested',note:'العميل مهتم ويطلب عرضًا',nextDate:'',by:'cs_west',byName:'cs_west',at:'2026-10-13T08:00:00.000Z'},'the answer carries its outcome, text and author');
 eq(byId(queue('owner'),'s-7').cancelReason,'تم الحل','a cancellation keeps its reason');
 eq(byId(queue('owner'),'s-7').cancelledByName,'rep2','and who cancelled');
}

// ---- the badge on the Visits entry
{
 const missed=(id)=>S.missedVisits(scoped(id),now);
 eq(S.supportBadge(queue('cs_east'),missed('cs_east'),'customer_service'),4,'the eastern representative: two requests plus two missed visits of their region');
 eq(S.supportBadge(queue('cs_all'),missed('cs_all'),'customer_service'),4,'the shared representative: three requests plus the one central missed visit nobody is named for');
 eq(S.supportBadge(queue('csm'),missed('csm'),'customer_service_manager'),1,'the manager: the request that is late');
 eq(S.supportBadge(queue('owner'),missed('owner'),'admin'),2,'the administrator: the late request and the unroutable one');
 eq(S.supportBadge(queue('rep'),missed('rep'),'rep'),1,'a representative: the answer they have not opened');
 eq(S.supportBadge(queue('sup'),[],'supervisor'),0,'a supervisor: nothing');
 eq(S.supportBadge([],[],'customer_service'),0,'nothing at all');
}

// ---- missed visits: derived, narrow, and never for sales roles
{
 const missed=(id,when=now,extra={})=>S.missedVisits({...scoped(id),...extra},when);
 const customersOf=list=>list.map(e=>e.customerId);
 eq(customersOf(missed('owner')),['c-4','c-15','c-18','c-17','c-12'],'the administrator: every branch, the oldest first');
 eq(customersOf(missed('csm')),['c-4','c-15','c-12'],'the manager: their branch only');
 eq(customersOf(missed('cs_all')),['c-4','c-15','c-12'],'the representative for every region: the whole branch');
 eq(customersOf(missed('cs_east')),['c-15','c-12'],'the eastern representative: the east only');
 eq(customersOf(missed('cs_west')),[],'the western one has none');
 eq(customersOf(missed('cs_b')),['c-17'],'another branch\'s own');
 for(const id of ['rep','rep2','sup','sm','sm2','outside'])eq(missed(id),[],id+' receives no missed visits: they are customer service\'s work');
 const excluded=['c-1','c-2','c-3','c-5','c-6','c-7','c-8','c-9','c-10','c-11','c-13','c-14'],all=customersOf(missed('owner'));
 for(const id of excluded)ok(!all.includes(id),id+' is not a missed visit');
 // the rule, one condition at a time
 eq([byId(missed('owner'),'missed-'+records.find(r=>r.kind==='activity'&&r.parentId==='c-12').id).overdueDays,missed('owner').find(e=>e.customerId==='c-4').overdueDays],[2,31],'overdue days count from the follow-up date');
 const first=missed('cs_east')[1];
 eq([first.customerName,first.customerPhone,first.customerCity,first.customerRegion,first.repId,first.repName,first.plan.nextDate,first.plan.nextAction,first.plan.result,first.missedSince,first.routedToId,first.permissions.take,first.unrouted],['مصنع c-12','0551234512','مدينة c-12','الشرقية','rep','rep','2026-10-12','زيارة متابعة','سلبية','2026-10-13T21:00:00.000Z','cs_east',true,false],'a missed visit carries the customer, the representative and the plan, and since when it is missed');
 eq(first.id,'missed-'+first.visitId,'its identity is its plan\'s visit');
 eq(missed('cs_all').map(e=>[e.customerId,e.routedToId,e.permissions.take]),[['c-4','',true],['c-15','cs_east',false],['c-12','cs_east',false]],'what is routed to the eastern representative can be seen but not taken by the others');
 eq(missed('csm').map(e=>e.permissions.take),[true,true,true],'the manager may take any');
 eq(missed('owner').find(e=>e.customerId==='c-18').unrouted,true,'a branch without customer service is flagged unrouted');
 eq(Object.keys(missed('csm')[0]).sort(),['customerCity','customerId','customerName','customerPhone','customerRegion','customerVersion','id','missedSince','overdueDays','permissions','plan','repId','repName','routedToId','routedToName','unrouted','visitId'],'the entry has these fields and no others');
 eq(Object.keys(missed('csm')[0].plan).sort(),['nextAction','nextDate','result','visitDate','visitId'],'the plan has no visit text');
 ok(!/PRIVATE/.test(JSON.stringify(missed('owner'))+JSON.stringify(queue('owner'))),'no visit summary or note reaches customer service');
 // the day and the window
 eq(customersOf(missed('csm','2026-10-13T20:59:59.000Z')),['c-4','c-15'],'one second before midnight in Riyadh the two-day rule has not yet met c-12');
 eq(customersOf(missed('csm','2026-10-13T21:00:00.000Z')),['c-4','c-15','c-12'],'at midnight in Riyadh it has');
 eq(customersOf(missed('csm','2026-10-15T09:00:00.000Z')),['c-15','c-12'],'after thirty days of being missed, the oldest visit is no longer routed');
 eq(customersOf(missed('csm','2026-10-13T09:00:00.000Z')),['c-4','c-15'],'a day earlier: c-12 is still only one day past');
 // what takes a customer out of the list
 const plan=(customerId)=>records.find(r=>r.kind==='activity'&&r.parentId===customerId).id;
 const open15=row('s-20','c-15','open',{},{origin:'missed_visit',requestedBy:'cs_all',plan:{visitId:plan('c-15'),visitDate:'',result:'',nextAction:'',nextDate:''}});
 eq(customersOf(missed('csm',now,{support:[...support,open15]})),['c-4','c-12'],'a request being worked on takes it out of the list');
 eq(customersOf(missed('csm',now,{support:[...support,{...open15,data:{...open15.data,status:'cancelled'}}]})),['c-4','c-12'],'so does one that was cancelled for that visit');
 const other=row('s-21','c-15','open',{},{});
 eq(customersOf(missed('csm',now,{support:[...support,other]})),['c-4','c-12'],'and any open request for the customer');
 const newer=[...records,visit('c-15','rep2',{startedAt:'2026-10-13T07:00:00.000Z',result:'تم أخذ موعد',nextDate:'2026-10-20'})];
 eq(customersOf(missed('csm',now,{all:newer})),['c-4','c-12'],'a later visit by anyone takes it out of the list');
 const again=[...records,visit('c-10','rep',{startedAt:'2026-10-07T07:00:00.000Z',nextDate:'2026-10-08'})];
 eq(customersOf(missed('csm',now,{all:again})).includes('c-10'),true,'a new negative visit after a handled one is a new missed visit');
 const inactive=members.map(x=>x.id==='cs_east'?{...x,active:0}:x);
 eq(missed('csm',now,{members:inactive}).map(e=>[e.customerId,e.routedToId,e.unrouted]),[['c-4','',false],['c-15','',false],['c-12','',false]],'with the representative of a region away, the shared representative takes over without a name');
 eq(missed('owner').length,5,'the same answer on every read');
}

// ---- nothing is invented for a role that has no business here
eq(S.supportQueue({...scoped('rep'),me:{...members.find(x=>x.id==='rep'),role:'viewer'}},now),[],'an unexpected role is given nothing');
eq(S.SUPPORT_TARGET_HOURS+'/'+S.MISSED_VISIT_GRACE_DAYS+'/'+S.MISSED_VISIT_WINDOW_DAYS+'/'+S.SUPPORT_HISTORY_DAYS,'4/2/30/30','the decided figures');
eq(Object.keys(S.supportOutcomes),['reached_interested','reached_not_interested','wants_visit','no_answer','wrong_number','other'],'the outcomes customer service may record');
eq(S.supportState({status:'open',handlerId:''}),'waiting','open and nobody holds it: waiting');
eq(S.supportState({status:'open',handlerId:'cs'}),'in_progress','open and held: in progress');
eq([S.supportState({status:'done',handlerId:'cs'}),S.supportState({status:'cancelled',handlerId:''})],['done','cancelled'],'finished states');

console.log(JSON.stringify({ok:true,checks,pureFunctions:true,productionDataUsed:false}));
