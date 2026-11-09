// «الصلاحيات» per member (lib/permissions*.ts, migration 0020; GSCO tests/security-permission-matrix, security-section-access,
// security-permission-switches): migration 0020 on a fresh database and on one of 20 migrations; the rules (every role's defaults are
// today's behaviour on every screen, normalising, the role ceiling, copying, the administrator never locked out, a hidden screen's
// requests); and the routes on an isolated in-memory SQLite (the route modules compiled as the build does, the session faked): the
// administrator's save (version, 409, audit before/after kept out of the recent changes, retry), a switched-off action refused with its
// message while other members are unaffected, a hidden screen answering 404, the commit re-checking the permissions' version, and
// «عرض بيانات الفريق بالكامل» widening what a supervisor reads, never what they write. Synthetic people only; no build, no network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {initializeDatabase,inspectInitializedDatabase} from '../portable/initialize.mjs';
import {upgradeExistingDatabase} from '../portable/upgrade.mjs';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'permissions-')),work=fs.mkdtempSync(path.join(os.tmpdir(),'yourrest-permissions-')),seen=new Set();
process.on('exit',()=>{fs.rmSync(out,{recursive:true,force:true});fs.rmSync(work,{recursive:true,force:true});});
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};

// ---- 1. Migration 0020: twenty-one migrations, a fresh database and the upgrade of a 20-migration one with its backup.
const NEW='0020_member_permissions.sql';
const all=fs.readdirSync(path.join(root,'drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).sort(),before=all.filter(name=>name<NEW);
eq([all.length,all.at(-1),before.length],[21,NEW,20],'twenty-one migrations, the newest the member permissions');
const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
{
 const schema=new DatabaseSync(':memory:');for(const name of before)schema.exec(fs.readFileSync(path.join(root,'drizzle',name),'utf8'));
 const seedTables=['crm_members','crm_settings','crm_records','crm_visit_numbers','crm_visit_files','crm_sales','crm_performance_targets','crm_target_sets','crm_kpi_assessments','crm_service_cases','crm_audit'];
 const tables=Object.fromEntries(seedTables.map(table=>[table,{columns:[schema.prepare(`PRAGMA table_info("${table}")`).all()[0].name],rows:[]}]));schema.close();
 tables.crm_members={columns:['id','user_id','email','name','role','branch','created_at','region_scope'],rows:[{id:'owner',user_id:'synthetic-owner',email:'permissions-test@yourrest.org',name:'Synthetic owner',role:'admin',branch:'test',created_at:'2026-11-01T00:00:00Z',region_scope:'all'}]};
 tables.crm_settings={columns:['id','owner_id'],rows:[{id:'company',owner_id:'synthetic-owner'}]};
 tables.crm_records={columns:['id','kind','assigned_to','branch','data','created_at','updated_at'],rows:[{id:'synthetic-customer',kind:'customer',assigned_to:'owner',branch:'test',data:'{"name":"Synthetic factory"}',created_at:'2026-11-01T00:00:00Z',updated_at:'2026-11-01T00:00:00Z'}]};
 const seed=path.join(work,'seed.json'),checksum=path.join(work,'seed.sha256');
 fs.writeFileSync(seed,JSON.stringify({format:'yourrest-namecheap-export-v1',tables}));fs.writeFileSync(checksum,digest(seed));
 const fixture=(name,names)=>{
  const appRoot=path.join(work,name,'app'),migrations=path.join(appRoot,'release','drizzle'),data=path.join(work,name,'private-data');
  fs.mkdirSync(migrations,{recursive:true,mode:0o700});fs.mkdirSync(data,{mode:0o700});
  for(const file of names)fs.copyFileSync(path.join(root,'drizzle',file),path.join(migrations,file));
  fs.writeFileSync(path.join(migrations,'manifest.json'),JSON.stringify({format:'yourrest-migrations-v1',files:names.map(file=>({name:file,sha256:digest(path.join(migrations,file))}))}));
  return{filename:path.join(data,'database.sqlite'),migrations,appRoot,seed,checksum};
 };
 const read=(filename,fn)=>{const db=new DatabaseSync(filename,{readOnly:true});try{return fn(db);}finally{db.close();}};
 const table=db=>db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='crm_member_permissions'").all().map(row=>row.name);
 const fresh=fixture('fresh',all);
 eq(initializeDatabase(fresh).migrations,21,'a new database takes the twenty-one migrations');
 eq(read(fresh.filename,table),['crm_member_permissions'],'with the permissions table');
 const old=fixture('upgrade',before);
 eq(initializeDatabase(old).migrations,20,'the live schema: 20 migrations');
 const live=new DatabaseSync(old.filename);live.exec("INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES('kept','synthetic-customer','Synthetic owner','تعديل','{}','2026-11-02T00:00:00Z')");live.close();
 fs.copyFileSync(path.join(root,'drizzle',NEW),path.join(old.migrations,NEW));
 fs.writeFileSync(path.join(old.migrations,'manifest.json'),JSON.stringify({format:'yourrest-migrations-v1',files:all.map(file=>({name:file,sha256:digest(path.join(old.migrations,file))}))}));
 eq(inspectInitializedDatabase(old),{pending:[NEW],migrations:21},'0020 is the one pending migration');
 const upgraded=await upgradeExistingDatabase(old);
 eq([upgraded.upgraded,upgraded.migrations,path.basename(upgraded.backup).startsWith('before-0020_member_permissions-')],[true,21,true],'the upgrade applies it after a private schema backup');
 eq(read(upgraded.backup,db=>[db.prepare('SELECT COUNT(*) n FROM yr_schema_migrations').get().n,table(db)]),[20,[]],'the backup is the 20-migration database');
 eq(read(old.filename,db=>[db.prepare('SELECT COUNT(*) n FROM yr_schema_migrations').get().n,table(db),db.prepare("SELECT id FROM crm_audit").all().map(row=>row.id),db.prepare("SELECT COUNT(*) n FROM crm_records").get().n,db.prepare('SELECT COUNT(*) n FROM crm_member_permissions').get().n]),[21,['crm_member_permissions'],['kept'],1,0],'the upgraded database keeps its data, gains the table, and nobody has a saved row (everyone as their role)');
 const db=new DatabaseSync(old.filename);db.exec('PRAGMA foreign_keys=ON');
 for(const bad of ["'[]','[]'","'{}','{}'","'not json','[]'"])assert.throws(()=>db.prepare(`INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_by,updated_at) VALUES('owner',${bad},1,'owner','t')`).run(),/CHECK/,'a malformed row is refused: '+bad);checks+=3;
 assert.throws(()=>db.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_by,updated_at) VALUES('owner','{}','[]',0,'owner','t')").run(),/CHECK/);checks++;
 assert.throws(()=>db.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_by,updated_at) VALUES('ghost','{}','[]',1,'owner','t')").run(),/FOREIGN KEY/);checks++;
 // Saving permissions never signs anyone out: the session-revoke trigger (0009) watches crm_members only.
 const authBefore=db.prepare("SELECT auth_version v FROM crm_members WHERE id='owner'").get().v;
 db.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_by,updated_at) VALUES('owner','{\"customer:delete\":false}','[]',1,'owner','t')").run();
 db.prepare("UPDATE crm_member_permissions SET version=2 WHERE member_id='owner'").run();
 eq(db.prepare("SELECT auth_version v FROM crm_members WHERE id='owner'").get().v,authBefore,'a permissions save leaves the member signed in');
 db.close();
}

// ---- 2. The shared rules (compiled from the source as the build does).
function compile(relative){if(seen.has(relative))return;seen.add(relative);const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';compile(source);return 'from '+JSON.stringify(path.join(out,source.replace(/\.tsx?$/,'.mjs')));});fs.writeFileSync(dest,code);}
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const u=globalThis.testUser;if(!u)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version FROM crm_members WHERE user_id=?').bind(u.userId).first();return {...u,provider:'email-otp',memberId:m?.id||'missing',memberVersion:m?.auth_version};}`);
for(const name of ['crm','visits','trash','sales','targets','reviews','journeys'])compile('app/api/'+name+'/route.ts');
const P=await import(pathToFileURL(path.join(out,'lib/permissions.mjs'))),A=await import(pathToFileURL(path.join(out,'lib/access.mjs')));
const ROLES=['admin','manager','supervisor','rep','customer_service','customer_service_manager'];

// Defaults: today's behaviour. Every screen shows exactly as lib/access.ts canViewPage says, every cell of the role's ceiling is on.
for(const role of ROLES){
 const me={role,access:P.memberAccess(role,null)};
 eq(me.access,{version:0,off:[],hidden:[],viewAll:false},role+': no saved row, nothing switched off');
 for(const screen of P.PERMISSION_SCREENS){
  eq(P.pageAllowed(me,screen),A.canViewPage(role,screen),role+' sees '+screen+' as before');
  for(const action of P.PERMISSION_ACTIONS)eq(P.can(me,screen,action),P.cellCeiling(role,screen,action),role+' '+screen+':'+action+' as the role');
 }
}
// The ceilings, pinned: what each role does today on each screen (the table of the guide).
const ceiling=role=>P.PERMISSION_CELLS.filter(key=>{const [screen,action]=key.split(':');return P.cellCeiling(role,screen,action);});
eq(ceiling('admin'),P.PERMISSION_CELLS,'the administrator has every cell');
eq(ceiling('manager'),['customer:add','customer:edit','customer:delete','customer:export','customer:import','activity:add','activity:edit','activity:delete','activity:export','followup:add','followup:edit','followup:delete','mold-requests:add','mold-requests:edit','mold-requests:delete','journeys:add','quote:add','quote:edit','quote:delete','quote:export','sales:add','sales:edit','sales:delete','sales:export','sales:import','targets:edit','targets:export','trash:edit'],'the sales manager');
eq(ceiling('supervisor'),['customer:add','customer:edit','customer:export','activity:add','activity:edit','activity:delete','activity:export','followup:add','followup:edit','followup:delete','mold-requests:add','mold-requests:edit','mold-requests:delete','journeys:add','quote:add','quote:edit','quote:delete','quote:export','sales:add','sales:edit','sales:delete','sales:export','sales:import','targets:export'],'the supervisor');
eq(ceiling('rep'),['customer:add','customer:edit','activity:add','followup:add','mold-requests:add','mold-requests:edit','mold-requests:delete'],'the representative');
eq(ceiling('customer_service'),['customer:edit','activity:add','activity:edit','activity:export','complaints:add','complaints:edit','mold-requests:add','mold-requests:edit','mold-requests:delete'],'customer service');
eq(ceiling('customer_service_manager'),['customer:edit','activity:add','activity:edit','activity:export','complaints:add','complaints:edit','service-kpi:edit','mold-requests:add','mold-requests:edit','mold-requests:delete'],'the customer-service manager');
eq(PERMISSION_ROWS_WITH_CELLS(),['customer','activity','complaints','service-kpi','followup','mold-requests','journeys','quote','sales','targets','team','trash'],'the screens with actions; dashboard, map and competitors have «استعراض» only');
function PERMISSION_ROWS_WITH_CELLS(){return P.PERMISSION_MATRIX.filter(row=>Object.keys(row.cells).length).map(row=>row.screen);}

// Normalising: within the role only, a cell never saved is on, junk is dropped.
let n=P.normalizePermissions('supervisor',{cells:{'customer:delete':false,'customer:edit':false,'quote:add':'no','sales:import':false,'bogus':false},hidden:['sales','team','trash','sales',7,'nowhere'],viewAll:true});
eq([n.cells['customer:edit'],n.cells['quote:add'],n.cells['sales:import'],'customer:delete' in n.cells,'bogus' in n.cells],[false,true,false,false,false],'cells beyond the role and unknown keys are dropped; a non-false value is on');
eq(n.hidden,['sales'],'only screens the role has can be hidden, once each');
eq(n.viewAll,true,'«عرض بيانات الفريق بالكامل» exists for the supervisor');
eq(P.normalizePermissions('rep',{viewAll:true}).viewAll,false,'not for a representative (reads stay as the role: decided, writes on own data only)');
eq(P.normalizePermissions('customer_service',{viewAll:true}).viewAll,false,'nor for customer service');
eq(P.normalizePermissions('supervisor',null).viewAll,false,'off by default');
// The administrator is never locked out: nothing hidden, the team cells always on; other cells may be switched off.
n=P.normalizePermissions('admin',{cells:{'team:add':false,'team:edit':false,'customer:delete':false},hidden:['team','trash','dashboard']});
eq([n.cells['team:add'],n.cells['team:edit'],n.cells['customer:delete'],n.hidden],[true,true,false,[]],'admin: team cells forced on, nothing hidden, the rest may be switched off');
const adminMe={role:'admin',access:{version:3,off:['team:edit','customer:delete'],hidden:['team'],viewAll:false}};
eq([P.can(adminMe,'team','edit'),P.pageAllowed(adminMe,'team'),P.can(adminMe,'customer','delete')],[true,true,false],'even a forged access object cannot lock the administrator out of the team page');
// The ceiling: a switch never refuses what the role cannot do anyway (the routes' own checks answer, with their own words).
const forged={role:'rep',access:{version:1,off:['customer:delete','sales:import'],hidden:['trash'],viewAll:true}};
eq([P.cellRefused(forged,'customer','delete'),P.can(forged,'customer','delete'),P.pageHidden(forged,'trash'),A.viewsWholeTeam(forged)],[false,false,true,false],'beyond the role: not "refused by a switch", still not allowed; viewAll never applies to a representative');
// Saved row → what applies.
const access=P.memberAccess('manager',{permissions:JSON.stringify({'customer:delete':false,'trash:edit':false,'viewAll':true,'junk':false}),hidden:JSON.stringify(['sales','team']),version:4});
eq(access,{version:4,off:['customer:delete','trash:edit'],hidden:['sales'],viewAll:true},'a saved row: switched-off cells, hidden screens of the role, viewAll');
eq(P.memberAccess('manager',{permissions:'not json',hidden:'{',version:2}),{version:2,off:[],hidden:[],viewAll:false},'an unreadable row is the role\'s behaviour (never more)');
// Copying: every cell of the target's ceiling takes the source's value; what the target's role cannot hold is skipped and listed.
const managerSaved=P.normalizePermissions('manager',{cells:{'customer:delete':false,'quote:delete':false},hidden:['trash','competitors'],viewAll:true});
let copied=P.copyPermissions({role:'manager',stored:managerSaved},'supervisor');
eq([copied.stored.cells['quote:delete'],copied.stored.cells['customer:edit'],copied.stored.hidden,copied.stored.viewAll],[false,true,['competitors'],true],'manager → supervisor: values copied within the supervisor\'s role');
eq(copied.skipped,['customer:import','targets:edit','trash:edit','browse:trash'],'skipped: what the supervisor\'s role cannot hold (customer:delete was off, so nothing to skip there)');
eq(copied.skipped.map(key=>P.permissionKeyText(key)),['العملاء · استيراد','المستهدفات وتقييم الأداء · تحرير','المحذوفات · تحرير','المحذوفات · استعراض'],'and named in Arabic');
copied=P.copyPermissions({role:'rep',stored:P.normalizePermissions('rep',{cells:{'customer:add':false}})},'supervisor');
eq([copied.stored.cells['customer:add'],copied.stored.cells['activity:edit'],copied.stored.cells['sales:add']],[false,false,false],'rep → supervisor: the supervisor\'s cells a representative does not have come over off (GSCO copies the value)');
copied=P.copyPermissions({role:'supervisor',stored:P.normalizePermissions('supervisor',{hidden:['sales'],viewAll:true})},'admin');
eq([copied.stored.hidden,copied.stored.cells['team:edit'],copied.skipped],[[],true,['browse:sales','viewAll']],'→ administrator: nothing hidden, team kept, the rest listed');
// A hidden screen's requests: closed only when every screen sharing them is hidden or not the role's.
const sup={role:'supervisor',access:{version:1,off:[],hidden:['sales'],viewAll:false}};
eq([P.pagesBlocked(sup,['sales']),P.pagesBlocked(sup,['sales','targets']),P.pagesBlocked({...sup,access:{...sup.access,hidden:['sales','targets']}},['sales','targets'])],[true,false,true],'/api/sales: open while «المستهدفات» uses it');
eq(P.pagesBlocked({role:'customer_service',access:{version:1,off:[],hidden:['complaints'],viewAll:false}},['service-kpi','complaints']),true,'customer service: the evaluation is read on «الشكاوى» only');
eq(P.pagesBlocked({role:'customer_service_manager',access:{version:1,off:[],hidden:['complaints'],viewAll:false}},['service-kpi','complaints']),false,'its manager still has «تقييم خدمة العملاء»');
eq([A.resolveCRMPage('supervisor','sales',['sales']),A.resolveCRMPage('supervisor','sales',[]),A.resolveCRMPage('rep','activity',['activity']),A.resolveCRMPage('admin','team',['team'])],['activity','sales','customer','team'],'a hidden screen opens the first one the member has');
eq([P.cellRefusalText('customer','delete'),P.cellRefusalText('sales','import','en'),P.PAGE_HIDDEN_TEXT],['مش مسموح لك بالحذف في العملاء. راجع مدير النظام.','You are not allowed to import in Sales. Ask the administrator.','هذا الجزء غير متاح لحسابك. راجع مدير النظام.'],'the two messages');
eq([P.recordCell('customer','delete',{}),P.recordCell('factory','delete',{}),P.recordCell('activity','edit',{data:{visitWorkflow:'followup-v1'}}),P.recordCell('activity','delete',{data:{}}),P.recordCell('opportunity','add',{data:{}}),P.recordCell('opportunity','edit',{data:{hasRequest:false}}),P.recordCell('quote','delete',{})],[['customer','delete'],['customer','edit'],['followup','edit'],['activity','delete'],['quote','add'],['followup','edit'],['quote','delete']],'/api/crm: each kind to its cell');
// «عرض بيانات الفريق بالكامل»: reads widen (read:true), writes keep the team.
const people=[{id:'owner',role:'admin'},{id:'mgr',role:'manager'},{id:'mgr2',role:'manager'},{id:'sup',role:'supervisor',supervisorId:'mgr'},{id:'sup2',role:'supervisor',supervisorId:'mgr'},{id:'rep1',role:'rep',supervisorId:'sup'},{id:'rep2',role:'rep',supervisorId:'sup2'},{id:'cs',role:'customer_service'}].map(m=>({...m,email:m.id+'@yourrest.org',name:m.id,branch:'b',active:1,target:0}));
const ids=set=>[...set].sort();
const supWide={...people[3],access:{version:1,off:[],hidden:[],viewAll:true}};
eq([ids(A.salesScopeMemberIds(people,people[3])),ids(A.salesScopeMemberIds(people,supWide)),ids(A.salesScopeMemberIds(people,supWide,{read:true}))],[['rep1','sup'],['rep1','sup'],['mgr','mgr2','owner','rep1','rep2','sup','sup2']],'the supervisor: team by default and for writes, every sales member for reads with viewAll');
const mgrWide={...people[1],access:{version:1,off:[],hidden:[],viewAll:true}};
eq(ids(A.salesScopeMemberIds(people,mgrWide,{read:true})),['mgr','mgr2','owner','rep1','rep2','sup','sup2'],'the sales manager reads other managers and the administrator too');
const visit2={id:'v2',kind:'activity',parentId:'c',assignedTo:'rep2',branch:'b',data:{performedBy:'rep2'}};
const supAccess=A.salesRecordAccess(people,supWide);
eq([supAccess.canRead(visit2),supAccess.readOnly(visit2),A.canReadSalesRecord(visit2,people,supWide),A.canReadSalesRecord(visit2,people,supWide,{read:true})],[true,true,false,true],'another team\'s visit: read, read only; the write check (assertRecordMutation) still refuses it');

// ---- 3. The routes on an isolated database.
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const name of all)sql.exec(fs.readFileSync(path.join(root,'drizzle',name),'utf8'));
let race=null;
class Statement{constructor(q,a=[]){this.q=q;this.a=a;}bind(...a){return new Statement(this.q,a);}async run(){const r=sql.prepare(this.q).run(...this.a);return{meta:{changes:Number(r.changes)}};}async all(){return{results:sql.prepare(this.q).all(...this.a)};}async first(){return sql.prepare(this.q).get(...this.a)||null;}}
const DB={prepare:q=>new Statement(q),batch:async statements=>{if(race){const fn=race;race=null;await fn();}sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(/^\s*(SELECT|WITH)/i.test(s.q)?{...await s.all(),meta:{changes:0}}:await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid'};
const now=new Date().toISOString(),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const member=(id,role,supervisor=null,region='all')=>sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,1,0,?)').run(id,'u-'+id,id+'@yourrest.org','اسم '+id,role,'الرئيسي',supervisor,region,now);
member('owner','admin');member('mgr','manager');member('mgr2','manager');member('sup','supervisor','mgr');member('sup2','supervisor','mgr');
member('rep1','rep','sup','eastern');member('rep2','rep','sup2','eastern');member('cs','customer_service','mgr');
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-owner')").run();
const record=(id,kind,parent,assigned,data,at=now)=>sql.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').run(id,kind,parent,assigned,'الرئيسي',JSON.stringify(data),at,at);
const customer=(id,assigned)=>record(id,'customer',null,assigned,{name:'مصنع '+id,region:'الشرقية',city:'الدمام',location:'26.43, 50.03',code:'',customerType:'',customerStatus:'',category:'',shortAddress:'',address:'',contact:'',phone:'',email:''});
customer('c1','rep1');customer('c2','rep2');customer('c3','rep1');customer('c4','rep1');
const visit=(id,by,customerId='c1')=>record(id,'activity',customerId,by,{type:'visit',date:day,summary:'تعريف',result:'تمت',outcome:'pending',notes:'',performedBy:by,responsibleId:by,recordedByEmail:by+'@yourrest.org'});
visit('v1','rep1');visit('v2','rep2','c2');
const user=id=>{globalThis.testUser=id?{userId:'u-'+id,email:id+'@yourrest.org',fullName:id}:null;};
const route=name=>import(pathToFileURL(path.join(out,'app/api/'+name+'/route.mjs')));
const crm=await route('crm'),visits=await route('visits'),trash=await route('trash'),sales=await route('sales'),reviews=await route('reviews');
const call=async(handler,{as,body,url='https://test.invalid/api/x',origin='https://test.invalid'},status=200)=>{
 user(as);const request=body===undefined?new Request(url):new Request(url,{method:'POST',headers:{origin,'content-type':'application/json'},body:typeof body==='string'?body:JSON.stringify(body)});
 const response=await handler(request),data=await response.json();eq(response.status,status,(as||'anonymous')+' '+url+' '+JSON.stringify(body||'').slice(0,140)+' -> '+JSON.stringify(data).slice(0,300));return data;
};
const state=as=>call(crm.GET,{as,url:'https://test.invalid/api/crm'});
const raw=id=>{const row=sql.prepare('SELECT * FROM crm_records WHERE id=?').get(id);return row&&{...row,data:JSON.parse(row.data)};};
const savePerms=(as,memberId,version,input,status,requestId)=>call(crm.POST,{as,url:'https://test.invalid/api/crm',body:{action:'permissions',memberId,version,cells:{},hidden:[],viewAll:false,...input,...(requestId?{requestId}:{})}},status);
const remove=(as,id,status)=>call(crm.POST,{as,url:'https://test.invalid/api/crm',body:{action:'delete',kind:raw(id).kind,id,version:raw(id).version}},status);
const editCustomer=(as,id,status)=>{const row=raw(id);return call(crm.POST,{as,url:'https://test.invalid/api/crm',body:{action:'save',kind:'customer',id,version:row.version,data:{...row.data,contact:'تعديل '+Date.now()}}},status);};

// Release day: nobody has a saved row; GET /api/crm sends the member's own access (role defaults) and, to the administrator, everyone's.
let mine=await state('mgr');
eq(mine.me.access,{version:0,off:[],hidden:[],viewAll:false},'the manager: role defaults');
ok(mine.members.every(m=>m.permissions===undefined),'nobody but the administrator receives saved permissions');
let admin=await state('owner');
eq(admin.members.find(m=>m.id==='mgr').permissions.version,0,'the administrator sees each member, never saved: version 0');
eq(admin.members.find(m=>m.id==='mgr').permissions.cells['customer:delete'],true,'with every cell of the role on');
// Who saves: the administrator only.
for(const as of ['mgr','sup','rep1','cs'])await savePerms(as,'rep1',0,{},403);
await savePerms('owner','ghost',0,{},404);
await savePerms('owner','mgr',0,{cells:{'customer:delete':'off'}},400);
await savePerms('owner','mgr',0,{surprise:true},400);
// The administrator removes «حذف» on customers from the manager.
const requestId=crypto.randomUUID();
let saved=await savePerms('owner','mgr',0,{cells:{'customer:delete':false,'bogus:add':false,'team:edit':false},hidden:['sales','team'],viewAll:false},200,requestId);
eq([saved.permissions.version,saved.permissions.cells['customer:delete'],'team:edit' in saved.permissions.cells,saved.permissions.hidden],[1,false,false,['sales']],'saved within the manager\'s role: version 1');
eq((await savePerms('owner','mgr',0,{cells:{'customer:delete':false,'bogus:add':false,'team:edit':false},hidden:['sales','team']},200,requestId)).alreadySaved,true,'a retry of the same save answers as it did');
eq((await savePerms('owner','mgr',0,{cells:{'customer:delete':true}},409)).code,'PERMISSIONS_CONFLICT','a stale version is refused (409)');
const audit=sql.prepare("SELECT record_id,actor,action,detail FROM crm_audit WHERE action='صلاحيات'").all();
eq(audit.length,1,'one «صلاحيات» history entry');
const detail=JSON.parse(audit[0].detail);
eq([audit[0].record_id,audit[0].actor,detail.memberId,detail.before.version,detail.before.cells['customer:delete'],detail.after.version,detail.after.cells['customer:delete'],detail.after.hidden],['mgr','اسم owner','mgr',0,true,1,false,['sales']],'with before and after');
for(const as of ['owner','mgr'])ok(!(await state(as)).audits.some(a=>a.action==='صلاحيات'),'kept out of the recent changes of GET /api/crm ('+as+')');
// The manager's page picks it up on the next load; the server refuses it.
mine=await state('mgr');
eq(mine.me.access,{version:1,off:['customer:delete'],hidden:['sales'],viewAll:false},'the manager\'s next load carries the switches');
eq((await remove('mgr','c3',403)).error,'مش مسموح لك بالحذف في العملاء. راجع مدير النظام.','the manager may no longer delete a customer');
ok(raw('c3'),'the customer is still there');
await editCustomer('mgr','c3');
await remove('mgr2','c3');eq(raw('c3'),undefined,'another manager is unaffected: deleted');
// A hidden screen's requests answer 404 (never 401/403, which lock the offline session).
const salesGet=as=>call(sales.GET,{as,url:'https://test.invalid/api/sales?month='+day.slice(0,7)},200);
await salesGet('mgr');
await savePerms('owner','mgr',1,{cells:{'customer:delete':false},hidden:['sales','targets']});
eq((await call(sales.GET,{as:'mgr',url:'https://test.invalid/api/sales?month='+day.slice(0,7)},404)).error,'هذا الجزء غير متاح لحسابك. راجع مدير النظام.','both screens that read /api/sales hidden: 404');
await call(sales.POST,{as:'mgr',url:'https://test.invalid/api/sales',body:{action:'save',createKey:crypto.randomUUID(),data:{}}},404);
await salesGet('mgr2');
await savePerms('owner','mgr',2,{hidden:['trash']});
await call(trash.GET,{as:'mgr',url:'https://test.invalid/api/trash?type=all'},404);
await call(trash.POST,{as:'mgr',url:'https://test.invalid/api/trash',body:{auditId:'x',requestId:crypto.randomUUID()}},404);
await call(trash.GET,{as:'mgr2',url:'https://test.invalid/api/trash?type=all'});
await salesGet('mgr');
// «تحرير» on «المحذوفات» off: the list stays, restoring is refused.
await savePerms('owner','mgr',3,{cells:{'trash:edit':false}});
await call(trash.GET,{as:'mgr',url:'https://test.invalid/api/trash?type=all'});
eq((await call(trash.POST,{as:'mgr',url:'https://test.invalid/api/trash',body:{auditId:'x',requestId:crypto.randomUUID()}},403)).error,'مش مسموح لك بالتعديل في المحذوفات. راجع مدير النظام.','restoring refused with its message');
// Visits: «إضافة» and «تحرير» per member.
await savePerms('owner','sup',0,{cells:{'activity:edit':false}});
const visitBody=(id,extra={})=>({createKey:crypto.randomUUID(),customerId:'c1',...extra,data:{type:'visit',purpose:'تعريف',summary:'تعريف',result:'تمت',outcome:'pending',notes:'',nextAction:'',nextDate:'',date:day,...(extra.data||{})}});
const v1=raw('v1');
eq((await call(visits.POST,{as:'sup',url:'https://test.invalid/api/visits',body:{...visitBody('v1'),id:'v1',version:v1.version}},403)).error,'مش مسموح لك بالتعديل في الزيارات. راجع مدير النظام.','the supervisor may no longer edit a saved visit');
await savePerms('owner','rep1',0,{cells:{'activity:add':false}});
eq((await call(visits.POST,{as:'rep1',url:'https://test.invalid/api/visits',body:visitBody()},403)).error,'مش مسموح لك بالإضافة في الزيارات. راجع مدير النظام.','the representative may no longer record a visit');
// The administrator's own account: nothing hidden, team always open, whatever is sent.
saved=await savePerms('owner','owner',0,{cells:{'team:add':false,'team:edit':false,'customer:delete':false},hidden:['team','trash']});
eq([saved.permissions.cells['team:add'],saved.permissions.cells['team:edit'],saved.permissions.hidden],[true,true,[]],'the administrator cannot lock themselves out');
await savePerms('owner','mgr',4,{});
eq((await state('owner')).me.access.hidden,[],'nothing is hidden from an administrator');
// The commit re-checks the permissions' version: a save by the administrator between the decision and the write fails it safe.
race=()=>{sql.prepare("UPDATE crm_member_permissions SET version=version+1 WHERE member_id='mgr'").run();};
await editCustomer('mgr','c4',409);
// «عرض بيانات الفريق بالكامل»: the supervisor reads another team's visit, read only; writing on it is refused.
let records=(await state('sup')).records;
ok(!records.some(r=>r.id==='v2'),'without it the supervisor does not see another team\'s visit');
await savePerms('owner','sup',1,{viewAll:true});
records=(await state('sup')).records;
const v2=records.find(r=>r.id==='v2');
ok(v2&&v2.data._teamReadOnly===true,'with it: shown, marked read only');
ok(!records.find(r=>r.id==='v1').data._teamReadOnly,'their own team\'s visit stays editable');
await remove('sup','v2',403);ok(raw('v2'),'the other team\'s visit cannot be deleted');
await savePerms('owner','sup',2,{viewAll:true});
// Writing on it: whatever the route checks first, it never saves (the commit guard keeps the team: assertRecordMutation, accessGuard).
const widened=await call(visits.POST,{as:'sup',url:'https://test.invalid/api/visits',body:{...visitBody(undefined,{data:{nextAction:'اتصال',nextDate:day,summary:'تعديل من مشرف آخر'}}),id:'v2',version:raw('v2').version,customerId:'c2',customerVersion:raw('c2').version}},403);
ok(/نطاق/.test(widened.error)&&raw('v2').data.summary==='تعريف','another team\'s visit is not edited: '+widened.error);
ok((await call(reviews.GET,{as:'sup',url:'https://test.invalid/api/reviews?date='+day+'&memberId=rep2'})).reviewable.length===0,'the day report of another team: read, nothing to note');
await call(reviews.POST,{as:'sup',url:'https://test.invalid/api/reviews',body:{kind:'entry',activityId:'v2',result:'زيارة جيدة',action:'تابع',version:null,requestId:crypto.randomUUID()}},403);
eq((await state('rep1')).records.some(r=>r.id==='v2'),false,'a representative is never widened');
// Notes on the day report: «إضافة» on «تقرير يوم المندوب».
await savePerms('owner','sup',3,{viewAll:false,cells:{'journeys:add':false}});
eq((await call(reviews.GET,{as:'sup',url:'https://test.invalid/api/reviews?date='+day+'&memberId=rep1'})).reviewable,[],'switched off: no note offered');
eq((await call(reviews.POST,{as:'sup',url:'https://test.invalid/api/reviews',body:{kind:'entry',activityId:'v1',result:'زيارة جيدة',action:'تابع',version:null,requestId:crypto.randomUUID()}},403)).error,'مش مسموح لك بالإضافة في تقرير يوم المندوب. راجع مدير النظام.','and refused');
await savePerms('owner','sup',4,{hidden:['journeys']});
await call(reviews.GET,{as:'sup',url:'https://test.invalid/api/reviews?date='+day+'&memberId=rep1'},404);
// A body over /api/crm's limit is still refused before it is read; a save from another site is refused.
await call(crm.POST,{as:'owner',url:'https://test.invalid/api/crm',body:{action:'permissions',memberId:'mgr',version:5,cells:{},hidden:[]},origin:'https://evil.example'},403);
console.log(JSON.stringify({ok:true,checks}));
