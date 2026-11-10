// «المحذوفات» (lib/trash.ts, lib/trash-server.ts, app/api/trash/route.ts): the real handlers over every drizzle migration in an in-memory
// SQLite. A deletion (POST /api/crm, unchanged refusals) now also records the journey links, the visit-plan pointers it removes, a
// customer's Yourrest number and ERP aliases; the list shows the deletions newest first, 40 a page, by type, the administrator all of them
// and a sales manager their own; a restoration puts each kind back (customer with its number, aliases, mapping; visit with its number,
// file, journey link and plan pointer; follow-up with its pointer, not over a newer one; machine, opportunity and quotation under their
// customer) at the next version, once (restore:<id>, a replay answers alreadySaved), and refuses: the parent first, a record with the same
// id, a number taken, another member's deletion for a manager, other roles. Deletions recorded before this release (no capture) restore
// from what they hold; a customer deleted before customers were numbered gets a new number. GET /api/crm never lists either entry.
// Since 2026-11-10 (the owner: whoever was granted «حذف» sees and restores their own deletions): who has the page by role and cells (404
// without it, as a hidden screen); a representative's and a supervisor's own list; a restoration refused when the record's cell is off (also
// after deleting, and at commit), for another member's deletion, out of their scope now; the receipt answering a retry after the cell went
// off; a child waiting for its customer; the manager and the administrator as before. Synthetic data only.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'trash-')),seen=new Set();
process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),'export async function getApplicationUser(){return globalThis.testUser;}');
// The products application's list is nudged after a write; here it is only counted.
fs.writeFileSync(path.join(out,'mold-hook.mjs'),'export function nudgeMoldCustomers(o){(globalThis.nudges??=[]).push(o);}export function wakeMoldRetries(){}');
function compile(relative){
 if(seen.has(relative))return;seen.add(relative);
 const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));
 fs.mkdirSync(path.dirname(dest),{recursive:true});
 let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
  if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));
  if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));
  if(imp==='@/lib/mold-customers-hook')return 'from '+JSON.stringify(path.join(out,'mold-hook.mjs'));
  if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
  let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
  if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';
  compile(source);return 'from '+JSON.stringify(path.join(out,source.replace(/\.tsx?$/,'.mjs')));
 });
 fs.writeFileSync(dest,code);
}
compile('app/api/crm/route.ts');compile('app/api/trash/route.ts');compile('lib/access.ts');
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const file of fs.readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+file,'utf8'));
class Statement{
 constructor(query,args=[]){this.query=query;this.args=args;}
 bind(...args){return new Statement(this.query,args);}
 async run(){return{meta:{changes:Number(sql.prepare(this.query).run(...this.args).changes)}};}
 async all(){return{results:sql.prepare(this.query).all(...this.args)};}
 async first(){return sql.prepare(this.query).get(...this.args)||null;}
}
// beforeBatch: a write by someone else between a request's reads and its commit (the commit race).
const DB={prepare:query=>new Statement(query),batch:async statements=>{const race=globalThis.beforeBatch;globalThis.beforeBatch=null;race?.();sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid'};
const now=new Date().toISOString();
const member=(id,name,role,region='all',supervisor=null)=>sql.prepare('INSERT INTO crm_members(id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,1,0,?)').run(id,id+'@yourrest.org',name,role,'HQ',supervisor,region,now);
member('owner','مدير النظام','admin');member('mgr','مدير المبيعات','manager');member('mgr2','مدير مبيعات الغربية','manager','western');member('sup','المشرف','supervisor','all','mgr');member('sup2','المشرف التاني','supervisor','all','mgr');member('rep','المندوب','rep','eastern','sup');member('adminw','مدير نظام الغربية','admin','western');member('repw','مندوب الغربية','rep','western','sup');
const login=id=>{const m=sql.prepare('SELECT * FROM crm_members WHERE id=?').get(id);globalThis.testUser={provider:'email-otp',memberId:id,memberVersion:m.auth_version,userId:'test-'+id,email:m.email,fullName:m.name};};
const crm=await import(path.join(out,'app/api/crm/route.mjs')),trash=await import(path.join(out,'app/api/trash/route.mjs'));
const {canViewPage,trashScope,resolveCRMPage}=await import(path.join(out,'lib/access.mjs'));
const {trashScopeOf,pageAllowed,memberAccess,trashRestoreCellOff,TRASH_DELETE_CELLS}=await import(path.join(out,'lib/permissions.mjs'));
let checks=0;
const check=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const raw=id=>sql.prepare('SELECT * FROM crm_records WHERE id=?').get(id);
const data=id=>JSON.parse(raw(id).data);
const request=(url,body)=>new Request('https://test.invalid'+url,body===undefined?{}:{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json'},body:JSON.stringify(body)});
const post=async(body,status=200)=>{const response=await crm.POST(request('/api/crm',body));const json=await response.json();check(response.status,status,JSON.stringify(json));return json;};
const list=async(query='',status=200)=>{const response=await trash.GET(request('/api/trash'+query));const json=await response.json();check(response.status,status,JSON.stringify(json));return json;};
const restore=async(auditId,status=200,requestId=crypto.randomUUID())=>{const response=await trash.POST(request('/api/trash',{auditId,requestId}));const json=await response.json();check(response.status,status,JSON.stringify(json));return json;};
const remove=(id,status=200)=>post({action:'delete',kind:raw(id).kind,id,version:raw(id).version},status);
const deletion=id=>sql.prepare("SELECT * FROM crm_audit WHERE record_id=? AND action='حذف' ORDER BY created_at DESC,rowid DESC").get(id);
const numberOf=id=>sql.prepare('SELECT number FROM crm_customer_numbers WHERE customer_id=?').get(id)?.number??null;
const aliasesOf=id=>sql.prepare('SELECT source_code FROM crm_customer_code_aliases WHERE customer_id=? ORDER BY source_code').all(id).map(row=>row.source_code);
const insert=(id,kind,parent,assignedTo,payload,version=1)=>sql.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,?)').run(id,kind,parent,assignedTo,'HQ',JSON.stringify(payload),'2026-01-0'+(1+(checks%8))+'T08:00:00.000Z',now,version);
const crmAudits=async()=>{const response=await crm.GET();return (await response.json()).audits.map(a=>a.action);};

// ---- who has the page (one function for a member: lib/permissions.ts trashScopeOf; lib/access.ts canViewPage is the role's ceiling)
const ROLES=['admin','manager','supervisor','rep','customer_service_manager','customer_service'];
check(ROLES.map(role=>[trashScope(role),canViewPage(role,'trash')]),[['all',true],['own',true],[null,true],[null,true],[null,false],[null,false]],'by role: the administrator all, the sales manager their own; a supervisor or a representative can have it (the ceiling), customer service never');
const who=(role,cells={},hidden=[])=>({role,access:memberAccess(role,{permissions:JSON.stringify(cells),hidden:JSON.stringify(hidden),version:1})});
check(ROLES.map(role=>[trashScopeOf(who(role)),pageAllowed(who(role),'trash')]),[['all',true],['own',true],[null,false],[null,false],[null,false],[null,false]],'without a «حذف» cell (the default): the administrator and the sales manager only');
check(TRASH_DELETE_CELLS,['customer:delete','activity:delete','followup:delete','quote:delete'],'the «حذف» cells that bring the page (not «إلغاء بيع»: a voided sale never reaches the trash)');
check([who('supervisor',{'quote:delete':true}),who('supervisor',{'customer:delete':true}),who('rep',{'activity:delete':true}),who('rep',{'followup:delete':true}),who('rep',{'customer:delete':true})].map(trashScopeOf),['own','own','own','own','own'],'any one of them on: their own deletions');
check([who('supervisor',{'sales:delete':true}),who('rep',{'quote:delete':true,'sales:delete':true}),who('customer_service',{'activity:delete':true,'customer:delete':true}),{role:'customer_service',access:{version:1,off:[],hidden:[],viewAll:false}},{role:'rep'},{role:'supervisor'}].map(trashScopeOf),[null,null,null,null,null,null],'not «إلغاء بيع», not a cell beyond the role, never customer service (a forged access included), nothing without an access read');
check([pageAllowed(who('rep',{'activity:delete':true}),'trash'),pageAllowed(who('rep',{'activity:delete':true},['trash']),'trash'),pageAllowed(who('admin',{'customer:delete':false,'activity:delete':false,'followup:delete':false,'quote:delete':false,'sales:delete':false},['trash']),'trash'),pageAllowed(who('manager',{},['trash']),'trash'),pageAllowed({role:'manager'},'trash')],[true,false,true,false,true],'«استعراض» still hides it; never from the administrator, whose cells are all off here');
check([resolveCRMPage('rep','trash'),resolveCRMPage('rep','trash',[],true),resolveCRMPage('supervisor','trash',[],false),resolveCRMPage('supervisor','trash',['trash'],true),resolveCRMPage('manager','trash'),resolveCRMPage('admin','trash')],['activity','trash','activity','activity','trash','trash'],'a bookmark of «المحذوفات» opens only for whom it is open');
check([trashRestoreCellOff(who('rep',{'activity:delete':true}),{kind:'activity',data:{}}),trashRestoreCellOff(who('rep',{'activity:delete':true}),{kind:'activity',data:{visitWorkflow:'followup-v1'}}),trashRestoreCellOff(who('supervisor',{'quote:delete':true}),{kind:'opportunity',data:{hasRequest:false}}),trashRestoreCellOff(who('supervisor',{'quote:delete':true}),{kind:'factory',data:{}}),trashRestoreCellOff(who('supervisor',{'quote:delete':true,'customer:edit':false}),{kind:'factory',data:{}}),trashRestoreCellOff(who('manager'),{kind:'activity',data:{}}),trashRestoreCellOff(who('admin',{'activity:delete':false}),{kind:'activity',data:{}})],[null,['followup','delete'],['followup','delete'],null,['customer','edit'],null,null],'the record\'s own cell (its deletion\'s): a visit, a follow-up, an old thread, a machine; never asked of the manager or the administrator');
for(const id of ['sup','rep']){login(id);check((await list('',404)).error,'هذا الجزء غير متاح لحسابك. راجع مدير النظام.',id+': no «حذف», no page: 404 as a hidden screen');await restore('x',404);}

// ---- a customer with its Yourrest number, two ERP aliases and an explicit mapping
login('owner');
const customer=(await post({action:'save',kind:'customer',data:{name:'مصنع الاسترجاع',code:'ERP-A',region:'الشرقية',city:'الدمام',location:'',assignedTo:'rep',branch:'HQ'}})).id;
await post({action:'save',kind:'customer',id:customer,version:raw(customer).version,data:{...data(customer),code:'ERP-A2'}});
sql.prepare("INSERT INTO crm_customer_code_mappings(code_key,customer_id,version,updated_by,updated_at) VALUES('ERP-A2',?,1,'owner',?)").run(customer,now);
const before={row:raw(customer),number:numberOf(customer),aliases:aliasesOf(customer)};
check(before.aliases,['ERP-A','ERP-A2'],'the old code is kept as an alias');
await remove(customer);
check(raw(customer),undefined,'deleted');
const customerEntry=deletion(customer),customerDetail=JSON.parse(customerEntry.detail);
check([customerDetail.capture,customerDetail.customerNumber,customerDetail.erpCodeAliases,customerDetail.codeMappings,customerDetail.deletedBy,customerDetail.journeyLinks,customerDetail.pointers],[1,before.number,['ERP-A','ERP-A2'],['ERP-A2'],'owner',[],[]],'the deletion keeps the number, the aliases and the mapping');
check([numberOf(customer),aliasesOf(customer)],[null,[]],'which the rows lose with the customer');
check(sql.prepare("SELECT json_extract(detail,'$.crmNumber') AS n FROM crm_audit WHERE action='mold-customers:removed'").all().map(r=>r.n),[before.number],'production is told it is gone (unchanged)');
let page=await list();
check(page.items.map(item=>[item.type,item.title,item.number,item.deletedBy,item.blocked]),[['customer','مصنع الاسترجاع','YR-C-'+String(before.number).padStart(6,'0'),'مدير النظام',null]],'the list: type, name, its Yourrest code, who deleted it');
check([page.scope,page.next],['all',null]);
// another member's write between: the restoration takes the next version, keeps the creation time
const restored=await restore(customerEntry.id);
check([restored.ok,restored.id,restored.type,restored.notes],[true,customer,'customer',[]],'restored, nothing skipped');
const back=raw(customer);
check([back.kind,back.parent_id,back.assigned_to,back.branch,back.created_at,back.version],[before.row.kind,null,'rep','HQ',before.row.created_at,before.row.version+1],'same id, kind, assignee, branch and creation time, at the next version');
check(JSON.parse(back.data),JSON.parse(before.row.data),'the same data (nothing the context adds is stored)');
check([numberOf(customer),aliasesOf(customer),sql.prepare('SELECT customer_id FROM crm_customer_code_mappings WHERE code_key=?').get('ERP-A2')?.customer_id],[before.number,['ERP-A','ERP-A2'],customer],'its own Yourrest number, aliases and mapping are back');
check(sql.prepare("SELECT COUNT(*) AS n FROM crm_records r JOIN crm_customer_numbers n ON n.customer_id=r.id WHERE r.kind='customer' AND n.number=?").get(before.number).n,1,'production\'s customer list (that join) has it again under the same number');
check(globalThis.nudges?.at(-1),{soon:true},'and the products application\'s list is checked soon');
const receipt=sql.prepare("SELECT * FROM crm_audit WHERE id=?").get('restore:'+customerEntry.id);
check([receipt.action,receipt.record_id,receipt.actor,JSON.parse(receipt.detail).version],['استرجاع سجل',customer,'مدير النظام',before.row.version+1],'the receipt «استرجاع سجل»');
check((await list()).items,[],'no longer listed');
await restore(customerEntry.id,409).then(json=>check(json.error,'السجل اتسترجع قبل كده.'));
const actions=await crmAudits();
check([actions.includes('حذف'),actions.includes('استرجاع سجل'),actions.includes('تعديل')],[false,false,true],'GET /api/crm lists neither the deletion nor the restoration of a record that exists again');
const {context}=await import(path.join(out,'lib/crm-server.mjs'));
check((await context()).all.find(row=>row.id===customer).data.internalCode,'YR-C-'+String(before.number).padStart(6,'0'),'the same YR-C code');

// a replay of the same request answers as the first did
await remove(customer);
const second=deletion(customer),requestId=crypto.randomUUID();
check((await restore(second.id,200,requestId)).alreadySaved,undefined);
check((await restore(second.id,200,requestId)).alreadySaved,true,'the same request again: alreadySaved');

// ---- an ERP code that now belongs to another customer stays with it
const coded=(await post({action:'save',kind:'customer',data:{name:'مصنع الكود القديم',code:'ERP-B',region:'الشرقية',location:'',assignedTo:'rep',branch:'HQ'}})).id;
await remove(coded);
const newcomer=(await post({action:'save',kind:'customer',data:{name:'مصنع الكود الجديد',code:'erp-b',region:'الشرقية',location:'',assignedTo:'rep',branch:'HQ'}})).id;
const codedBack=await restore(deletion(coded).id);
check(codedBack.notes,['لم يُسترجع كود ERP «ERP-B»: أصبح للعميل «مصنع الكود الجديد».'],'restored without the code, and says so');
check([data(coded).code,aliasesOf(coded),aliasesOf(newcomer)],['',[],['erp-b']],'the code stays the other customer\'s only');

// ---- a number taken meanwhile is refused with its code
const numbered=(await post({action:'save',kind:'customer',data:{name:'مصنع الرقم',region:'الشرقية',location:'',assignedTo:'rep',branch:'HQ'}})).id;
const takenNumber=numberOf(numbered);await remove(numbered);
sql.prepare('UPDATE crm_customer_numbers SET number=? WHERE customer_id=?').run(takenNumber,newcomer);
const takenItem=(await list('?type=customer')).items.find(item=>item.recordId===numbered);
check(takenItem.number,'YR-C-'+String(takenNumber).padStart(6,'0'));
check((await restore(deletion(numbered).id,409)).error,'رقم يورست YR-C-'+String(takenNumber).padStart(6,'0')+' أصبح لعميل آخر؛ لا يمكن استرجاع العميل بنفس الرقم.','refused, nothing written');
check(raw(numbered),undefined);

// ---- a record with the same id exists
const twin=(await post({action:'save',kind:'customer',data:{name:'مصنع التوأم',region:'الشرقية',location:'',assignedTo:'rep',branch:'HQ'}})).id;
const twinRow=raw(twin);await remove(twin);
sql.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').run(twin,'customer',null,'rep','HQ',twinRow.data,now,now);
check((await list()).items.find(item=>item.recordId===twin).blocked,'السجل موجود بالفعل.','listed with why');
check((await restore(deletion(twin).id,409)).error,'السجل موجود بالفعل.');

// ---- a visit: its number, its file, its journey link and the customer's plan pointer
const home=(await post({action:'save',kind:'customer',data:{name:'مصنع الزيارات',region:'الشرقية',location:'',assignedTo:'rep',branch:'HQ'}})).id;
sql.prepare("INSERT INTO crm_visit_numbers(record_id) VALUES('visit-1')").run();
const visitNumber=sql.prepare("SELECT number FROM crm_visit_numbers WHERE record_id='visit-1'").get().number;
sql.prepare("INSERT INTO crm_visit_files(id,object_key,customer_id,name,content_type,size,uploaded_by,created_at) VALUES('file-1','k1',?,'منافس.pdf','application/pdf',10,'rep',?)").run(home,now);
sql.prepare("INSERT INTO crm_journey_stops(id,member_id,date,customer_id,region_scope,snapshot,selected_at,closed_at,state,data) VALUES('stop-1','rep','2026-11-09',?,'eastern','{}',?,?,'completed','{}')").run(home,now,now);
insert('visit-1','activity',home,'rep',{type:'visit',date:'2026-11-09',summary:'زيارة متابعة',performedBy:'rep',visitNumber,competitorFileId:'file-1',journeyStopId:'stop-1',timingSource:'journey'});
sql.prepare("INSERT INTO crm_journey_links(stop_id,activity_id) VALUES('stop-1','visit-1')").run();
const plan={visitId:'visit-1',date:'2026-11-09',nextAction:'اتصال',nextDate:'2026-11-12'};
sql.prepare("UPDATE crm_records SET data=json_set(data,'$._visitPlan',json(?)) WHERE id=?").run(JSON.stringify(plan),home);
const visitBefore=raw('visit-1');
await remove('visit-1');
check([data(home)._visitPlan,sql.prepare("SELECT COUNT(*) AS n FROM crm_journey_links").get().n],[undefined,0],'the deletion removes the pointer, the link goes with the row');
const visitDetail=JSON.parse(deletion('visit-1').detail);
check([visitDetail.journeyLinks,visitDetail.pointers,visitDetail.customer],[['stop-1'],[{id:home,field:'_visitPlan',value:plan}],{id:home,name:'مصنع الزيارات',region:'الشرقية'}],'and keeps both, and its customer');
const visitItem=(await list('?type=visit')).items[0];
check([visitItem.type,visitItem.title,visitItem.number,visitItem.customerName,visitItem.blocked],['visit','زيارة متابعة',String(visitNumber),'مصنع الزيارات',null],'listed by number and customer');
check((await list('?type=followup')).items.length,0,'not a follow-up');
await restore(deletion('visit-1').id);
check([raw('visit-1').version,data('visit-1').visitNumber,data('visit-1').competitorFileId,sql.prepare("SELECT customer_id FROM crm_visit_files WHERE id='file-1'").get().customer_id],[visitBefore.version+1,visitNumber,'file-1',home],'its number and its file');
check([sql.prepare("SELECT stop_id FROM crm_journey_links WHERE activity_id='visit-1'").get()?.stop_id,data(home)._visitPlan],['stop-1',plan],'its journey link and the customer\'s plan pointer');

// ---- a follow-up's pointer goes back only where nothing newer took its place
insert('follow-1','activity',home,'rep',{visitWorkflow:'followup-v1',type:'call',date:'2026-11-10',summary:'متابعة العرض',result:'اتصال',performedBy:'rep'});
sql.prepare("UPDATE crm_records SET data=json_set(data,'$._visitPlan',json(?)) WHERE id=?").run(JSON.stringify({...plan,visitId:'follow-1'}),home);
await remove('follow-1');
check((await list('?type=followup')).items.map(item=>[item.type,item.title]),[['followup','متابعة العرض']],'a follow-up');
sql.prepare("UPDATE crm_records SET data=json_set(data,'$._visitPlan',json(?)) WHERE id=?").run(JSON.stringify(plan),home);
const homeVersion=raw(home).version;
await restore(deletion('follow-1').id);
check([data(home)._visitPlan.visitId,raw(home).version],['visit-1',homeVersion],'the customer points to a newer contact: left as it is');
sql.prepare("UPDATE crm_records SET data=json_set(data,'$._visitPlan',json(?)) WHERE id=?").run(JSON.stringify({...plan,visitId:'follow-1'}),home);
await remove('follow-1');
check(data(home)._visitPlan,undefined,'deleted again while the customer pointed to it');
await restore(deletion('follow-1').id);
check(data(home)._visitPlan,{...plan,visitId:'follow-1'},'pointing nowhere: it points to the follow-up again');

// ---- machine, opportunity and quotation under a customer; the parent first
insert('machine-1','factory',home,'rep',{name:'ماكينة بلوك',recordType:'machine',machineBrand:'Besser',machineModel:'V3'});
insert('opp-1','opportunity',home,'rep',{moldType:'قالب بلوك',product:'بلوك 20',dimensions:'40x20',quantity:1,stage:'technical',technicalStatus:'approved',technicalNotes:'ok',nextAction:'عرض',nextDate:'2026-11-20',performedBy:'owner'});
insert('quote-1','quote','opp-1','rep',{number:'YR-2026-AB12',date:'2026-11-09',validUntil:'2026-11-30',status:'sent',items:[{description:'قالب',quantity:1,price:100}],taxRate:15,performedBy:'owner'});
await remove('machine-1');await remove('opp-1',400);await remove('quote-1');await remove('opp-1');
page=await list();
check(page.items.slice(0,3).map(item=>[item.type,item.title,item.customerName]),[['opportunity','قالب بلوك','مصنع الزيارات'],['quote','YR-2026-AB12','مصنع الزيارات'],['machine','ماكينة بلوك','مصنع الزيارات']],'newest first, each with its customer (a quotation\'s through its deleted opportunity)');
check(page.items[1].blocked,'استرجع السجل الأصلي أولًا: الفرصة «قالب بلوك».','the quotation waits for its opportunity');
check((await restore(deletion('quote-1').id,409)).error,'استرجع السجل الأصلي أولًا: الفرصة «قالب بلوك».','refused');
await restore(deletion('opp-1').id);await restore(deletion('quote-1').id);await restore(deletion('machine-1').id);
check(['machine-1','opp-1','quote-1'].map(id=>[raw(id).parent_id,raw(id).version]),[[home,2],[home,2],['opp-1',2]],'all three back under their parents');

// ---- a sales manager: their own deletions only («حذف» is off by default since 2026-11-09: the administrator granted it)
sql.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_by,updated_at) VALUES('mgr','{\"customer:delete\":true}','[]',1,'owner',?)").run(now);
login('mgr');
const managed=(await post({action:'save',kind:'customer',data:{name:'مصنع المدير',region:'الشرقية',location:'',assignedTo:'rep',branch:'HQ'}})).id;
await remove(managed);
page=await list();
check([page.scope,page.items.map(item=>item.recordId)],['own',[managed]],'the manager sees what they deleted, nothing of the administrator\'s');
login('owner');
const ownerItems=(await list('?type=customer')).items.map(item=>item.recordId);
check(ownerItems.includes(managed)&&ownerItems.includes(numbered),true,'the administrator sees everyone\'s');
const adminVisit=(await (async()=>{insert('visit-2','activity',home,'rep',{type:'call',date:'2026-11-09',summary:'اتصال',performedBy:'rep'});await remove('visit-2');return deletion('visit-2');})());
login('mgr');
check((await restore(adminVisit.id,403)).error,'استرجاع ما حذفه غيرك متاح لمدير النظام فقط.','a manager restoring the administrator\'s deletion: 403');
await restore(deletion(managed).id);
check(raw(managed).assigned_to,'rep','their own: restored');
login('mgr2');
check((await list()).items,[],'the western manager deleted nothing');

// ---- deletions recorded before this release
login('owner');
const legacy=(id,record,extra={})=>sql.prepare("INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES(?,?,?,?,?,?)").run('legacy-'+id,id,'مدير قديم','حذف',JSON.stringify({kind:record.kind,deletedBy:'owner',record:{id,parentId:null,assignedTo:'rep',branch:'HQ',createdAt:'2025-05-01T08:00:00.000Z',updatedAt:'2025-06-01T08:00:00.000Z',version:3,...record},...extra}),'2025-06-01T08:00:00.000Z');
legacy('old-numbered',{kind:'customer',data:{name:'عميل قديم مرقم',code:'OLD-2',region:'الشرقية',assignedTo:'rep',branch:'HQ',internalCode:'YR-C-000777',_erpCodeAliases:['OLD-1','OLD-2']}});
legacy('old-unnumbered',{kind:'customer',data:{name:'عميل قبل الترقيم',region:'الشرقية',assignedTo:'rep',branch:'HQ'}});
legacy('old-visit',{kind:'activity',parentId:home,data:{type:'visit',date:'2025-05-01',summary:'زيارة قديمة',performedBy:'rep',journeyStopId:'stop-1',visitNumber:900}});
const legacyItems=(await list()).items.filter(item=>item.id.startsWith('legacy-'));
check(legacyItems.map(item=>[item.recordId,item.number,item.note,item.blocked]),[['old-visit','900',null,null],['old-unnumbered','',`حُذف قبل ترقيم العملاء: يُسترجع برقم يورست جديد.`,null],['old-numbered','YR-C-000777',null,null]],'listed (same time: by id) and restorable; the customer without a number says it gets a new one');
check((await restore('legacy-old-numbered')).notes,[],'an old customer: back');
check([numberOf('old-numbered'),aliasesOf('old-numbered'),raw('old-numbered').version,'internalCode' in data('old-numbered')],[777,['OLD-1','OLD-2'],4,false],'with the number and aliases its record held');
const fresh=await restore('legacy-old-unnumbered');
check(fresh.notes,['استُرجع العميل برقم يورست جديد YR-C-'+String(numberOf('old-unnumbered')).padStart(6,'0')+' (حُذف قبل ترقيم العملاء).'],'deleted before numbering: a new number, said');
await restore('legacy-old-visit');
check([sql.prepare("SELECT stop_id FROM crm_journey_links WHERE activity_id='old-visit'").get()?.stop_id,data('old-visit').visitNumber],['stop-1',900],'an old visit gets its journey link back from the stop it names');

// ---- an administrator of some regions: the deletions within them
const western=(await post({action:'save',kind:'customer',data:{name:'مصنع الغربية',region:'الغربية',location:'',assignedTo:'repw',branch:'HQ'}})).id;
insert('visit-w','activity',western,'repw',{type:'call',date:'2026-11-09',summary:'اتصال الغربية',performedBy:'repw'});
await remove('visit-w');await remove(western);
login('adminw');
check((await list()).items.map(item=>item.recordId),[western,'visit-w'],'the western administrator: the western customer and its contact (through the deleted customer), nothing eastern');
check((await restore(deletion(numbered).id,403)).error,'السجل خارج نطاق صلاحيتك','an eastern customer: out of their scope');
await restore(deletion(western).id);await restore(deletion('visit-w').id);
check([raw(western).kind,raw('visit-w').parent_id],['customer',western],'their own region: restored');
login('owner');

// ---- 40 a page, then the next
for(let i=0;i<45;i++)sql.prepare("INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES(?,?,?,?,?,?)").run('bulk-'+String(i).padStart(2,'0'),'bulk-record-'+i,'مدير النظام','حذف',JSON.stringify({kind:'factory',deletedBy:'owner',record:{id:'bulk-record-'+i,kind:'factory',parentId:home,assignedTo:'rep',branch:'HQ',createdAt:now,version:1,data:{name:'ماكينة '+i}}}),'2026-11-0'+(1+i%5)+'T10:00:00.000Z');
const first=await list('?type=machine');
check([first.items.length,!!first.next],[40,true],'40, then more');
const rest=await list('?type=machine&before='+encodeURIComponent(first.next));
check([rest.items.length,rest.next],[5,null],'the remaining five');
check(new Set([...first.items,...rest.items].map(item=>item.id)).size,45,'no entry twice');
check([...first.items,...rest.items].every((item,i,all)=>!i||all[i-1].deletedAt>=item.deletedAt),true,'newest first');
await list('?type=nothing',400);

// ---- the deletion itself refuses as before
insert('opp-2','opportunity',home,'rep',{moldType:'قالب',product:'p',dimensions:'d',quantity:1,stage:'new',nextAction:'x',nextDate:'2026-11-20',performedBy:'owner'});
insert('visit-3','activity','opp-2','rep',{type:'call',date:'2026-11-09',summary:'s',performedBy:'rep'});
check((await remove('opp-2',400)).error,'يوجد سجلات مرتبطة. احذفها قبل حذف هذا السجل.','a record with children is not deleted');
check(sql.prepare('PRAGMA foreign_key_check').all(),[]);check(sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');

// ---- «حذف» brings «المحذوفات» (the owner, 2026-11-10): their own deletions, restored while the record's own cell is on and within their scope
login('owner');
const grant=(id,cells,hidden=[])=>{if(sql.prepare('SELECT 1 FROM crm_member_permissions WHERE member_id=?').get(id))sql.prepare('UPDATE crm_member_permissions SET permissions=?,hidden=?,version=version+1 WHERE member_id=?').run(JSON.stringify(cells),JSON.stringify(hidden),id);else sql.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_by,updated_at) VALUES(?,?,?,1,'owner',?)").run(id,JSON.stringify(cells),JSON.stringify(hidden),now);};
const own=(id,summary,extra={})=>insert(id,'activity',home,'rep',{type:'call',date:'2026-11-10',summary,result:'اتصال',performedBy:'rep',...extra});
own('rv-1','زيارة المندوب الأولى');own('rv-2','زيارة المندوب التانية');own('rv-3','زيارة المندوب التالتة');own('rf-1','متابعة المندوب',{visitWorkflow:'followup-v1'});
login('rep');
check((await remove('rv-1',403)).error,'مش مسموح لك بالحذف في الزيارات. راجع مدير النظام.','no «حذف»: the representative deletes nothing (unchanged)');
grant('rep',{'activity:delete':true});
await remove('rv-1');
page=await list();
check([page.scope,page.items.map(item=>[item.recordId,item.type,item.customerName,item.deletedBy,item.blocked])],['own',[['rv-1','visit','مصنع الزيارات','المندوب',null]]],'granted «حذف» on visits: the page, with their own deletion only (none of the administrator\'s or the manager\'s)');
let receiptOf=crypto.randomUUID();
check((await restore(deletion('rv-1').id,200,receiptOf)).type,'visit','restored by the representative');
check([raw('rv-1').parent_id,raw('rv-1').assigned_to,data('rv-1').summary],[home,'rep','زيارة المندوب الأولى'],'the visit is back');
check(sql.prepare("SELECT actor FROM crm_audit WHERE id=?").get('restore:'+deletion('rv-1').id).actor,'المندوب','the receipt names them');
// the cell switched off after the restoration: a retry of the same request still answers as it did (the receipt first)
grant('rep',{'followup:delete':true});
check((await restore(deletion('rv-1').id,200,receiptOf)).alreadySaved,true,'a lost answer\'s retry after the cell went off: alreadySaved');
// deleted with the cell on, the cell switched off afterwards: listed with why, refused with it
grant('rep',{'activity:delete':true,'followup:delete':true});
await remove('rv-2');await remove('rf-1');
grant('rep',{'followup:delete':true});
const cellOff='استرجاع السجل ده محتاج صلاحية «حذف» في الزيارات، وهي مش مفتوحة لك دلوقتي. راجع مدير النظام.';
check((await list()).items.map(item=>[item.recordId,item.blocked]),[['rf-1',null],['rv-2',cellOff]],'«حذف» of visits off now: the visit says why; the follow-up (its cell on) can be restored');
check((await restore(deletion('rv-2').id,403)).error,cellOff,'refused: 403 with the reason');
check(raw('rv-2'),undefined,'nothing written');
await restore(deletion('rf-1').id);
check(data('rf-1').visitWorkflow,'followup-v1','the follow-up is back');
// every «حذف» cell off again: no page (404); their deletion stays for the administrator
grant('rep',{});
await list('',404);await restore(deletion('rv-2').id,404);
login('owner');
check((await list('?type=visit')).items.filter(item=>item.recordId==='rv-2').map(item=>[item.deletedBy,item.blocked]),[['المندوب',null]],'the administrator sees it, with who deleted it, and may restore it');
// «استعراض» hides it; «تحرير» (restoring) can be switched off on its own
grant('rep',{'activity:delete':true},['trash']);login('rep');
await list('',404);await restore(deletion('rv-2').id,404);
grant('rep',{'activity:delete':true,'trash:edit':false});
check((await list()).items.map(item=>item.recordId),['rv-2'],'«استرجاع» off: the list stays');
check((await restore(deletion('rv-2').id,403)).error,'مش مسموح لك بالتعديل في المحذوفات. راجع مدير النظام.','restoring refused with the switch\'s message');
grant('rep',{'activity:delete':true});
// another member's deletion: not listed, not restored
login('owner');await remove('rv-3');login('rep');
check((await list()).items.map(item=>item.recordId),['rv-2'],'the administrator\'s deletion of their visit is not theirs');
check((await restore(deletion('rv-3').id,403)).error,'استرجاع ما حذفه غيرك متاح لمدير النظام فقط.','nor restored by them');
// the cell switched off between the request's reads and its commit: nothing is written
globalThis.beforeBatch=()=>grant('rep',{'followup:delete':true});
check((await restore(deletion('rv-2').id,409)).error,'تغيّرت البيانات أثناء الاسترجاع. حدّث القائمة وأعد المحاولة.','the commit re-checks the permissions\' version');
check(raw('rv-2'),undefined,'not restored');
grant('rep',{'activity:delete':true});
await restore(deletion('rv-2').id);
check(raw('rv-2').version,2,'restored once the cell is on again');
// a customer assigned to them; a child waits for its customer
grant('rep',{'activity:delete':true,'customer:delete':true});
insert('rc-1','customer',null,'rep',{name:'عميل المندوب للحذف',region:'الشرقية',location:'',assignedTo:'rep',branch:'HQ'});
const rcNumber=numberOf('rc-1');
insert('rc-visit','activity','rc-1','rep',{type:'call',date:'2026-11-10',summary:'زيارة عميل المندوب',performedBy:'rep'});
await remove('rc-visit');await remove('rc-1');
page=await list();
check(page.items.slice(0,2).map(item=>[item.recordId,item.blocked]),[['rc-1',null],['rc-visit','استرجع السجل الأصلي أولًا: العميل «عميل المندوب للحذف».']],'their customer, and its visit waiting for it');
check((await restore(deletion('rc-visit').id,409)).error,'استرجع السجل الأصلي أولًا: العميل «عميل المندوب للحذف».','the parent first');
await restore(deletion('rc-1').id);await restore(deletion('rc-visit').id);
check([raw('rc-1').assigned_to,numberOf('rc-1'),raw('rc-visit').parent_id],['rep',rcNumber,'rc-1'],'the customer with its number, then its visit');
// moved out of the customer's regions: not listed, and refused
await remove('rv-1');
sql.prepare("UPDATE crm_members SET region_scope='western' WHERE id='rep'").run();login('rep');
check((await list()).items.map(item=>item.recordId),[],'a representative of another region now: their eastern deletion is not listed');
check((await restore(deletion('rv-1').id,403)).error,'السجل خارج نطاق صلاحيتك','and not restored');
sql.prepare("UPDATE crm_members SET region_scope='eastern' WHERE id='rep'").run();login('rep');
await restore(deletion('rv-1').id);
// a supervisor: their team's visit; refused once that representative is in another supervisor's team
grant('sup',{'activity:delete':true});login('sup');
own('sv-1','زيارة لفريق المشرف');
await remove('sv-1');
check((await list()).items.map(item=>[item.recordId,item.deletedBy,item.blocked]),[['sv-1','المشرف',null]],'the supervisor: their own deletion');
sql.prepare("UPDATE crm_members SET supervisor_id='sup2' WHERE id='rep'").run();login('sup');
check((await list()).items.map(item=>[item.recordId,item.blocked]),[['sv-1','السجل خارج نطاق صلاحيتك']],'its author is in another supervisor\'s team now: listed with why');
check((await restore(deletion('sv-1').id,403)).error,'السجل خارج نطاق صلاحيتك','and refused (out of what they may delete now)');
sql.prepare("UPDATE crm_members SET supervisor_id='sup' WHERE id='rep'").run();login('sup');
await restore(deletion('sv-1').id);
check(raw('sv-1').version,2,'their team again: restored');
// the sales manager and the administrator as before
grant('mgr',{});login('mgr');
check((await list()).scope,'own','the sales manager keeps the page without a «حذف» cell');
login('owner');check((await list()).scope,'all','the administrator all');

// ---- every message the routes answer with has its English (lib/locales/en.json, patterns for the named ones)
compile('lib/i18n.ts');compile('lib/trash.ts');
const i18n=await import(path.join(out,'lib/i18n.mjs')),words=await import(path.join(out,'lib/trash.mjs'));
i18n.installEnglish(JSON.parse(fs.readFileSync('lib/locales/en.json','utf8')));
const english=value=>i18n.translateText(value,'en');
const messages=[...Object.entries(words.TRASH_TEXT).filter(([key])=>key!=='linked').map(([,value])=>value),words.TRASH_NEW_NUMBER_NOTE,...[['customer','delete'],['activity','delete'],['followup','delete'],['quote','delete'],['customer','edit']].map(([screen,action])=>words.trashCellOff(screen,action)),'مدير النظام يقدر يسترجعه لاحقًا من «المحذوفات». لن يُحذف سجل له سجلات مرتبطة.',words.trashNumberTaken('YR-C-000777'),words.trashCodeSkipped('ERP-B','مصنع الكود الجديد'),words.trashNewNumber('YR-C-000012'),
 ...['العميل «مصنع»','الماكينة «ماكينة»','الفرصة «قالب بلوك»','عرض السعر «YR-1»','الزيارة رقم 12','الزيارة «زيارة»','المتابعة «متابعة»','السجل المرتبط'].map(words.trashParentFirst),'المحذوفات','يمكن استرجاعه لاحقًا من «المحذوفات». لن يُحذف سجل له سجلات مرتبطة.'];
check(messages.filter(message=>english(message)===message),[],'every message is translated');
check([english(words.trashParentFirst('الفرصة «قالب بلوك»')),english(words.trashCodeSkipped('ERP-B','مصنع الكود الجديد')),english(words.trashNumberTaken('YR-C-000777'))],['Restore the original record first: the opportunity «قالب بلوك».','ERP code «ERP-B» was not restored: it now belongs to the customer «مصنع الكود الجديد».','Yourrest number YR-C-000777 now belongs to another customer; the customer cannot be restored with the same number.'],'with the names in place');
console.log(JSON.stringify({ok:true,checks,syntheticData:true}));
