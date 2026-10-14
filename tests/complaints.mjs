// Customer complaints, as pure functions over an in-memory context built from the same compiled domain modules as production:
// the stage a complaint is in and when it is late (working hours), who may read it and act on it at every step, where each step may
// hand it (the customer's own representative first), what each reader is asked to do, the page's list and its sections, and that a
// complaint never leaks into the sales record lists. No database, no network, no production data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'complaints-')),seen=new Set();
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
compile('lib/complaints.ts');compile('lib/crm.ts');
const C=await import(path.join(out,'lib/complaints.mjs')),CRM=await import(path.join(out,'lib/crm.mjs'));
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual===undefined?undefined:JSON.parse(JSON.stringify(actual)),expected,message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};
const trueKeys=object=>Object.keys(object).filter(key=>object[key]===true).sort();

// ---- the tables the page translates from
eq(C.COMPLAINT_TARGET_HOURS,{review:4,assignment:4,delegation:4,first_contact:24,resolution:50,closure:24},'the working-hour targets of each stage');
eq([C.COMPLAINT_REOPEN_DAYS,C.COMPLAINT_HISTORY_DAYS,C.COMPLAINT_LIST_LIMIT,C.COMPLAINT_TEXT_MAX,C.COMPLAINT_DEMAND_MAX],[14,30,300,2000,500],'the other constants');
for(const [ar,en] of [[C.complaintCategories,C.complaintCategoriesEn],[C.complaintSeverities,C.complaintSeveritiesEn],[C.resolutionOutcomes,C.resolutionOutcomesEn],[C.closureOutcomes,C.closureOutcomesEn],[C.complaintStatusLabels,C.complaintStatusLabelsEn],[C.complaintActions,C.complaintActionsEn],[C.complaintChannels,C.complaintChannelsEn]])eq(Object.keys(ar),Object.keys(en),'every Arabic table has its English twin with the same keys');
eq(Object.keys(C.complaintStatusLabels),['submitted','returned','pending_assignment','assigned','resolved','closed','cancelled'],'the seven statuses');

// ---- a synthetic company: two branches, three regions, customer service split by region, two sales managers
const m=(id,role,supervisorId,regionScope='all',branch='الرئيسي',active=1)=>({id,userId:'u-'+id,email:id+'@yourrest.org',name:'الاسم '+id,role,branch,supervisorId,regionScope,active,target:0});
const members=[m('owner','admin'),m('sm','manager'),m('sm2','manager'),m('sup','supervisor','sm'),m('sup2','supervisor','sm2'),m('rep','rep','sup'),m('rep2','rep','sup'),m('rep_w','rep','sup','western'),m('outside','rep','sup2'),
 m('csm','customer_service_manager','sm'),m('csm2','customer_service_manager','sm2'),m('cs_east','customer_service','csm','eastern'),m('cs_west','customer_service','csm','western'),m('cs_all','customer_service','csm','all'),m('cs_lone','customer_service',''),m('cs_off','customer_service','csm','eastern','الرئيسي',0),
 m('csm_b','customer_service_manager','sm','all','فرع آخر'),m('cs_b','customer_service','csm_b','all','فرع آخر'),m('rep_b','rep','sup','all','فرع آخر')];
const region={east:'الشرقية',west:'الغربية',central:'الوسطى'};
const customer=(id,assignedTo,regionName,branch='الرئيسي')=>({id,kind:'customer',parentId:null,assignedTo,branch,data:{name:'مصنع '+id,region:regionName,phone:'05512345'+id.slice(-1).padStart(2,'0'),city:'مدينة '+id},createdAt:'2026-08-01T05:00:00.000Z',updatedAt:'2026-08-01T05:00:00.000Z',version:4});
const customers=[customer('c-1','rep',region.east),customer('c-2','rep2',region.west),customer('c-3','outside',region.east),customer('c-4','rep',region.central),customer('c-5','rep_b',region.east,'فرع آخر'),customer('c-6','rep',region.east)];
const now='2026-10-14T09:00:00.000Z';                       // Wednesday 12:00 in Riyadh
const RECENT='2026-10-14T06:00:00.000Z';                    // 09:00 today: 3 working hours ago
const LATE4='2026-10-13T12:00:00.000Z';                     // Tuesday 15:00: 3 + 4 = 7 working hours ago
const LATE24='2026-10-11T05:00:00.000Z';                    // Sunday 08:00: 34 working hours ago
const LATE50='2026-10-08T05:00:00.000Z';                    // Thursday 08:00: 54 working hours ago, Friday not counted
const base={kind:'complaint',customerId:'c-1',status:'submitted',registrarId:'cs_east',serviceManagerId:'csm',salesManagerId:'',supervisorId:'',assigneeId:'',channel:'call',category:'product_quality',severity:'normal',description:'القالب يخرج منتجًا مكسورًا',demand:'استبدال القالب',reference:'INV-100',contactName:'أبو خالد',contactPhone:'0551234501',
 submittedAt:RECENT,forwardedAt:'',returnedAt:'',assignedAt:'',delegatedAt:'',reassignedAt:'',rejectedAt:'',reopenedAt:'',resolvedAt:'',closedAt:'',cancelledAt:'',seenAt:'',returnNote:'',assignmentNote:'',rejectReason:'',cancelReason:'',previousAssignees:[],updates:[],notes:[],events:[]};
let serial=0;
const row=(data,extra={})=>{serial++;const merged={...base,...data};return {id:'complaint-'+serial,branch:extra.branch||'الرئيسي',assignedTo:merged.registrarId,data:merged,createdAt:merged.submittedAt,updatedAt:extra.updatedAt||merged.submittedAt,version:extra.version||1};};
const update=(by,at,text='اتصلت بالعميل وشرح المشكلة')=>({id:'u-'+at,at,by,channel:'call',date:at.slice(0,10),text});
const submitted=(at=RECENT,data={})=>row({status:'submitted',submittedAt:at,...data});
const returned=(at=RECENT,data={})=>row({status:'returned',submittedAt:LATE50,returnedAt:at,returnNote:'أضف رقم الفاتورة',...data});
const pending=(at=RECENT,data={})=>row({status:'pending_assignment',submittedAt:LATE50,forwardedAt:at,salesManagerId:'sm',...data});
const assigned=(at=RECENT,data={})=>row({status:'assigned',submittedAt:LATE50,forwardedAt:LATE50,assignedAt:at,salesManagerId:'sm',assigneeId:'rep',assignmentNote:'العميل مهم',...data});
const resolved=(at=RECENT,data={})=>row({status:'resolved',submittedAt:LATE50,forwardedAt:LATE50,assignedAt:LATE50,salesManagerId:'sm',assigneeId:'rep',updates:[update('rep',LATE24)],resolvedAt:at,resolution:{outcome:'solved',note:'استُبدل القالب',by:'rep',at},...data});
const closed=(at=RECENT,data={})=>row({...resolved(LATE4).data,status:'closed',closedAt:at,closure:{outcome:'satisfied',note:'العميل أكد الحل',by:'cs_east',at},...data},{updatedAt:at});
const ctx=(me,complaints,all=customers)=>({me:members.find(member=>member.id===me),members,all,complaints});
const reader=me=>C.complaintReader({me:members.find(member=>member.id===me),members});
const perms=(entry,me)=>C.complaintPermissions(entry,customers.find(c=>c.id===entry.data.customerId),reader(me),members,now);
const canRead=(entry,me)=>C.canReadComplaint(entry,customers.find(c=>c.id===entry.data.customerId),reader(me),members);
const awaiting=(entry,me)=>C.complaintAwaiting(entry.data,perms(entry,me),reader(me),members);

// ---- the stage and its target, in working hours
const stage=(entry,role='rep')=>{const p=C.complaintProgress(entry.data,role,now);return [p.stage,p.targetHours,p.stageHours,p.late];};
eq(stage(submitted()),['review',4,3,false],'a complaint registered three working hours ago waits for the review, not late');
eq(stage(submitted(LATE4)),['review',4,7,true],'seven working hours later it is late');
eq(stage(returned()),['fix',null,3,false],'a returned one waits for its registrar, with no target');
eq(stage(pending(LATE4)),['assignment',4,7,true],'the assignment counts from the forward');
eq(stage(assigned(),'supervisor'),['delegation',4,3,false],'held by a supervisor: a delegation');
eq(stage(assigned(LATE24)),['first_contact',24,34,true],'held by a representative who has not contacted the customer: the first contact, late after 24');
eq(stage(assigned(LATE24,{updates:[update('rep',LATE4)]})),['resolution',50,34,false],'once contacted, the resolution, counted from the assignment and not late before 50');
eq(stage(assigned(LATE50,{updates:[update('rep',LATE24)]})),['resolution',50,54,true],'and late after 50 working hours, Friday not counted');
eq(stage(assigned(LATE50,{updates:[update('rep',LATE24)],rejectedAt:RECENT,rejectReason:'العميل يقول إن المشكلة باقية'})),['first_contact',24,3,false],'returned by customer service: a new contact is expected, counted from the return');
eq(stage(assigned(LATE50,{updates:[update('rep',LATE24),update('rep',RECENT)],rejectedAt:LATE4})),['resolution',50,7,false],'and an update after the return starts the resolution again');
eq(stage(resolved(LATE4)),['closure',24,7,false],'resolved: customer service confirms within 24');
eq(stage(closed()),['closed',null,3,false],'closed has no target');
eq(stage(row({status:'cancelled',cancelledAt:RECENT})),['cancelled',null,3,false],'nor cancelled');
eq([C.reopenUntil(closed('2026-10-01T09:00:00.000Z').data),C.reopenUntil(resolved().data)],['2026-10-15T09:00:00.000Z',''],'a closed complaint may be reopened for fourteen days');
eq([C.registrarManager('cs_east',members),C.registrarManager('cs_lone',members),C.registrarManager('cs_b',members),C.registrarManager('nobody',members)],['csm','','csm_b',''],'the registrar\'s customer-service manager, when there is one');

// ---- who may read
const sees=(entry,ids)=>ids.filter(id=>canRead(entry,id));
const everyone=members.filter(member=>member.active).map(member=>member.id); // an inactive member cannot sign in, so is never a reader
eq(sees(submitted(),everyone),['owner','csm','cs_east','cs_all','cs_lone'],'just registered for an eastern customer: the administrator, the registrar\'s manager and the customer-service members of that branch who cover the region');
eq(sees(submitted(RECENT,{registrarId:'cs_lone',serviceManagerId:''}),everyone),['owner','csm','csm2','cs_east','cs_all','cs_lone'],'registered by someone with no manager: every customer-service manager of the branch may review it');
eq(sees(pending(),everyone),['owner','sm','csm','cs_east','cs_all','cs_lone'],'forwarded to a sales manager: he sees it, the other sales manager does not');
eq(sees(assigned(),everyone),['owner','sm','sm2','sup','rep','csm','cs_east','cs_all','cs_lone'],'assigned to a representative: his supervisor, the sales managers, and not his colleagues');
eq(sees(assigned(RECENT,{assigneeId:'sup'}),everyone),['owner','sm','sm2','sup','csm','cs_east','cs_all','cs_lone'],'held by a supervisor: not his representatives');
eq(sees(assigned(RECENT,{customerId:'c-2'}),everyone),['owner','sm','sm2','sup','rep','csm','cs_west','cs_all','cs_lone'],'a western customer: customer service of the west, not the east');
eq(sees(assigned(RECENT,{customerId:'c-5',registrarId:'cs_b',serviceManagerId:'csm_b',assigneeId:'rep_b'}),everyone),['owner','sm','sm2','sup','csm_b','cs_b','rep_b'],'another branch: its own customer service, and the representative it was assigned to');
eq(sees(assigned(RECENT,{customerId:'missing'}),everyone),[],'a complaint whose customer is gone is shown to nobody');
eq(everyone.filter(id=>C.canRegisterComplaint(customers[0],{me:members.find(member=>member.id===id)})),['owner','csm','csm2','cs_east','cs_all','cs_lone'],'who registers for an eastern customer of the main branch: customer service and its manager there, and the administrator');
eq(everyone.filter(id=>C.canRegisterComplaint(customers[4],{me:members.find(member=>member.id===id)})),['owner','csm_b','cs_b'],'and for the other branch, its own customer service');

// ---- who may do what, at every step
const permissionsOf=(entry,me)=>trueKeys(perms(entry,me));
eq([permissionsOf(submitted(),'cs_east'),permissionsOf(submitted(),'csm'),permissionsOf(submitted(),'owner'),permissionsOf(submitted(),'cs_all')],[['cancel','edit','note'],['cancel','forward','note','return'],['cancel','edit','forward','note','return'],['note']],'just registered: the registrar corrects or cancels, the manager forwards, returns or cancels, a colleague may only note');
eq([permissionsOf(submitted(RECENT,{registrarId:'cs_lone',serviceManagerId:''}),'csm2'),permissionsOf(submitted(),'csm2')],[['cancel','forward','note','return'],[]],'a manager reviews what has no manager, and nothing of another manager\'s team');
eq([permissionsOf(returned(),'cs_east'),permissionsOf(returned(),'csm'),permissionsOf(returned(),'cs_all')],[['cancel','edit','note'],['cancel','note'],['note']],'returned: the registrar corrects it');
eq([permissionsOf(pending(),'sm'),permissionsOf(pending(),'owner'),permissionsOf(pending(),'csm'),permissionsOf(pending(),'cs_east'),permissionsOf(pending(),'sm2')],[['assign','note'],['assign','cancel','note'],['note'],['note'],[]],'waiting for assignment: the sales manager it went to assigns; the other does not see it');
eq([permissionsOf(assigned(),'rep'),permissionsOf(assigned(),'sup'),permissionsOf(assigned(),'sm'),permissionsOf(assigned(),'sm2'),permissionsOf(assigned(),'owner'),permissionsOf(assigned(),'csm'),permissionsOf(assigned(),'cs_east'),permissionsOf(assigned(),'rep2')],
 [['note','resolve','seen','update'],['delegate','note'],['note','reassign'],['note'],['cancel','note','reassign','resolve','update'],['note'],['note'],[]],'assigned: the holder opens, updates and resolves; his supervisor may delegate; the sales manager it went to may reassign');
eq(permissionsOf(assigned(RECENT,{seenAt:RECENT}),'rep'),['note','resolve','update'],'once opened it is not opened again');
eq(permissionsOf(assigned(RECENT,{seenAt:LATE4,reassignedAt:RECENT,assignedAt:LATE4}),'rep'),['note','resolve','seen','update'],'but a new dispatch is opened anew');
eq([permissionsOf(assigned(RECENT,{assigneeId:'sup'}),'sup'),permissionsOf(assigned(RECENT,{assigneeId:'sup'}),'rep')],[['delegate','note','resolve','seen','update'],[]],'a supervisor holding it may delegate or work it himself');
eq([permissionsOf(resolved(),'cs_east'),permissionsOf(resolved(),'csm'),permissionsOf(resolved(),'owner'),permissionsOf(resolved(),'rep'),permissionsOf(resolved(),'sm'),permissionsOf(resolved(),'cs_all')],[['close','note','reject'],['close','note','reject'],['cancel','close','note','reject'],['note'],['note'],['note']],'resolved: the registrar or the manager closes it or sends it back');
eq([permissionsOf(closed(),'cs_east'),permissionsOf(closed(),'csm'),permissionsOf(closed(),'owner'),permissionsOf(closed(),'rep'),permissionsOf(closed('2026-09-20T09:00:00.000Z'),'cs_east')],[['reopen'],['reopen'],['reopen'],[],[]],'closed: reopened by customer service for fourteen days, then never');
eq(permissionsOf(row({status:'cancelled',cancelledAt:RECENT}),'owner'),[],'cancelled: nothing');

// ---- what each reader is asked to do
eq([awaiting(submitted(),'csm'),awaiting(submitted(),'owner'),awaiting(submitted(),'cs_east'),awaiting(submitted(RECENT,{registrarId:'cs_lone',serviceManagerId:''}),'owner'),awaiting(submitted(RECENT,{registrarId:'cs_lone',serviceManagerId:''}),'csm2')],['review',null,null,'review','review'],'the review waits for the manager; for the administrator only when there is no manager');
eq([awaiting(returned(),'cs_east'),awaiting(returned(),'csm')],['fix',null],'a returned complaint waits for its registrar');
eq([awaiting(pending(),'sm'),awaiting(pending(),'owner')],['assign',null],'the assignment waits for the sales manager it went to');
eq([awaiting(assigned(),'rep'),awaiting(assigned(RECENT,{updates:[update('rep',RECENT)]}),'rep'),awaiting(assigned(RECENT,{assigneeId:'sup'}),'sup'),awaiting(assigned(),'sup'),awaiting(assigned(),'sm')],['contact','resolve','delegate',null,null],'the holder is asked to contact, then to resolve; a supervisor to delegate');
eq([awaiting(resolved(),'cs_east'),awaiting(resolved(),'csm'),awaiting(resolved(),'owner'),awaiting(resolved(RECENT,{registrarId:'cs_off'}),'csm'),awaiting(resolved(RECENT,{registrarId:'cs_off'}),'owner')],['close',null,null,'close','close'],'the closure waits for the registrar; for the manager when the registrar is gone');

// ---- where a step may hand it
const names=list=>list.map(person=>person.id);
const forwardFrom=(me,entry=submitted())=>names(C.complaintCandidates(entry,customers[0],{me:members.find(member=>member.id===me),members},'forward'));
eq([forwardFrom('csm'),forwardFrom('csm2'),forwardFrom('owner'),forwardFrom('csm_b')],[['sm'],['sm2'],['sm','sm2'],['sm']],'a manager forwards to the sales manager linked to him; an administrator to any');
const assignFrom=(me,entry=pending(),action='assign')=>names(C.complaintCandidates(entry,customers.find(c=>c.id===entry.data.customerId),{me:members.find(member=>member.id===me),members},action));
eq(assignFrom('sm'),['rep','outside','rep2','sup','sup2'],'the sales manager assigns within the customer\'s branch and region, the customer\'s own representative first, the western one left out');
eq(assignFrom('sm',pending(RECENT,{customerId:'c-2'})),['rep2','outside','rep','rep_w','sup','sup2'],'for a western customer the western representative is in and the customer\'s own first');
eq(assignFrom('sm',pending(RECENT,{customerId:'c-5'})),['rep_b'],'another branch: its own people');
eq(assignFrom('sm',assigned(),'reassign'),['outside','rep2','sup','sup2'],'a reassignment never offers the current holder');
eq([assignFrom('sup',assigned(),'delegate'),assignFrom('sup',assigned(RECENT,{assigneeId:'sup'}),'delegate'),assignFrom('sup2',assigned(RECENT,{assigneeId:'sup2'}),'delegate')],[['rep2'],['rep','rep2'],['outside']],'a supervisor delegates to his own representatives of the region, not to the current holder');

// ---- the page's list
const list=(me,complaints,limit)=>C.complaintQueue(ctx(me,complaints),now,limit);
const sample=[submitted(LATE4),submitted(RECENT,{customerId:'c-6',severity:'high'}),returned(),pending(),assigned(LATE24),resolved(),closed(LATE4),closed('2026-09-01T09:00:00.000Z'),row({status:'cancelled',cancelledAt:RECENT,cancelReason:'سُجّلت خطأً'})];
const ids=entries=>entries.map(entry=>entry.id);
const csmList=list('csm',sample);
const S=sample.map(entry=>entry.id);
eq(ids(csmList),[S[0],S[1],S[4],S[2],S[3],S[5],S[8],S[6]],'the manager sees every open one and the recently finished ones; a complaint closed six weeks ago is gone');
eq(csmList.map(entry=>entry.awaiting),['review','review',null,null,null,null,null,null],'what waits for him comes first');
eq(csmList.slice(0,2).map(entry=>[entry.late,entry.severity]),[[true,'normal'],[false,'high']],'among those, the late one before the high one');
eq(csmList.map(entry=>entry.stage),['review','review','first_contact','fix','assignment','closure','cancelled','closed'],'with its stage: what waits for him, then the late one, then the oldest open ones, then the newest finished ones');
const first=csmList[0];
eq([first.customerName,first.customerPhone,first.customerCity,first.customerRegion,first.customerVersion,first.registrarName,first.serviceManagerName,first.contactName,first.contactPhone,first.category,first.channel,first.unrouted,first.ownerId,first.targetHours,first.late],['مصنع c-1','0551234501','مدينة c-1','الشرقية',4,'الاسم cs_east','الاسم csm','أبو خالد','0551234501','product_quality','call',false,'csm',4,true],'an entry carries the customer, the people by name, the report and the stage');
eq([first.permissions.forward,names(first.candidates),first.suggestedId],[true,['sm'],''],'and the hands it may go to');
const smList=list('sm',sample);
eq(smList.map(entry=>[entry.stage,entry.awaiting]),[['assignment','assign'],['first_contact',null],['closure',null],['closed',null]],'the sales manager sees what came to him and what his people hold');
eq([smList[0].candidates.map(person=>person.id)[0],smList[0].suggestedId,smList[0].currentRepName],['rep','rep','الاسم rep'],'with the customer\'s own representative suggested first');
eq(list('rep',sample).map(entry=>[entry.stage,entry.awaiting,entry.late]),[['first_contact','contact',true],['closure',null,false],['closed',null,false]],'the representative sees what he holds, late when the first contact is overdue, and what he resolved');
eq(list('cs_east',sample).map(entry=>entry.awaiting),['fix','close',null,null,null,null,null,null],'the registrar is asked to correct one and to close one');
eq(list('cs_west',sample),[],'customer service of the west sees none of these eastern complaints');
eq(list('rep2',sample),[],'a representative with nothing assigned sees nothing');
eq([list('csm',sample,3).length,list('csm',sample,Infinity).length],[3,8],'the list is cut for display and whole on request');
eq(C.complaintBadge(csmList),2,'the badge counts what waits for the reader');
eq([C.complaintBadge(list('rep',sample)),C.complaintBadge(list('cs_east',sample)),C.complaintBadge(list('owner',sample))],[1,2,0],'for each reader; an administrator is asked for nothing while the managers are there');
eq(C.complaintGroups(csmList).map(group=>[group.id,group.entries.length]),[['act',2],['open',4],['finished',2]],'the sections: what waits for me, the other open ones, the finished ones');
eq(C.complaintsOfCustomer(csmList,'c-6').map(entry=>entry.severity),['high'],'a customer\'s own complaints');
eq(list('owner',[submitted(RECENT,{registrarId:'cs_lone',serviceManagerId:''})]).map(entry=>[entry.unrouted,entry.awaiting]),[[true,'review']],'a complaint with no manager is marked and goes to the administrator');
const detailed=list('rep',[assigned(LATE24,{updates:[update('rep',LATE4,'زرت المصنع')],notes:[{id:'n1',at:LATE4,by:'csm',text:'العميل مهم جدًا'}],events:[{at:LATE50,by:'cs_east',action:'register'},{at:LATE24,by:'sm',action:'assign',targetId:'rep',text:'العميل مهم'}]})])[0];
eq([detailed.updates.map(update=>[update.text,update.byName]),detailed.notes.map(note=>note.byName),detailed.events.map(event=>[event.action,event.byName,event.targetName])],[[['زرت المصنع','الاسم rep']],['الاسم csm'],[['register','الاسم cs_east',''],['assign','الاسم sm','الاسم rep']]],'updates, notes and the story carry names');

// ---- a complaint never travels with the sales records
const complaintAsRecord={...assigned(),kind:'complaint'};
const all=[...customers,complaintAsRecord];
eq(CRM.scopeRecords(all,members,members.find(member=>member.id==='owner')).map(r=>r.kind).includes('complaint'),false,'the administrator\'s record list leaves complaints out');
eq(CRM.scopeRecords(all,members,members.find(member=>member.id==='rep')).map(r=>r.kind).includes('complaint'),false,'so does a representative\'s');
eq(CRM.scopeRecords(all,members,members.find(member=>member.id==='sm')).map(r=>r.kind).includes('complaint'),false,'and a sales manager\'s');
eq(CRM.scopeRecords(all,members,members.find(member=>member.id==='cs_east')),[],'customer service gets no records at all');
ok(C.isComplaintRow(complaintAsRecord)&&!C.isComplaintRow(customers[0]),'the kind is what tells a complaint apart');

console.log(JSON.stringify({ok:true,checks,coverage:'stages and working-hour targets, reading and acting matrix per status and role, routing candidates with the customer\'s representative first, what each reader is asked, the list and its cut, badge, sections, customer history, no leak into the record lists',realBrowser:false,realDevice:false}));
