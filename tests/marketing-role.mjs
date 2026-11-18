// «مسؤول تسويق» (the owner, 2026-11-18: «فيه وظيفة جديدة مسؤول تسويق ... بيشتغل زى المندوب»; lib/roles.ts) and the three customer
// classifications it sets (lib/customer-classification.ts), without a build. 1. The rules, on the real modules: the role is a field role
// everywhere a representative is named (pages, team and supervisor, tracking and the Android app's role, targets and evaluation, mold
// requests and the products application's salesmen, support and complaints, the visit place), the permissions matrix (a representative's
// cells, never «حذف عميل»), who corrects and who classifies which customer, and a guard over the sources: every remaining literal 'rep'
// of lib/ and app/ is listed here with the reason it stays a representative's alone (a new check written for 'rep' fails it until it is
// decided for the marketing officer too). 2. POST /api/crm and GET /api/crm on an isolated in-memory SQLite (the real migrations): the
// marketing officer corrects another representative's customer of their branch directly (no request), never another branch's, another
// region's, the routing or a deletion; the classifications by role (a representative and customer service refused, a supervisor's waiting
// in their request, the sales manager's and the administrator's direct), an unknown value refused, a save without them keeping them, a new
// customer saved on the device carrying them, the team screen's member of the new role. Synthetic people and customers only; no network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'marketing-role-')),seen=new Set();
process.on('exit',()=>{fs.rmSync(out,{recursive:true,force:true});});
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const u=globalThis.testUser;if(!u)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version FROM crm_members WHERE user_id=?').bind(u.userId).first();return {...u,provider:'email-otp',memberId:m?.id||'missing',memberVersion:m?.auth_version};}`);
/** A TypeScript source and what it imports, as ES modules in the run's folder; .mjs/.js sources are imported where they are. */
function compile(relative){
 if(seen.has(relative))return;seen.add(relative);
 const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});
 let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
  if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));
  if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));
  if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
  let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
  if(/\.json$/.test(source)){const target=path.join(out,source);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,source),target);return 'from '+JSON.stringify(target)+' with {type:"json"}';}
  if(/\.(mjs|js)$/.test(source))return 'from '+JSON.stringify(pathToFileURL(path.join(root,source)).href);
  if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';
  compile(source);return 'from '+JSON.stringify(path.join(out,source.replace(/\.tsx?$/,'.mjs')));
 });
 fs.writeFileSync(dest,code);
}
const lib=async name=>{compile('lib/'+name+'.ts');return import(pathToFileURL(path.join(out,'lib/'+name+'.mjs')));};
for(const name of ['crm','customer-edits'])compile('app/api/'+name+'/route.ts');
const roles=await lib('roles'),access=await lib('access'),permissions=await lib('permissions'),crmLib=await lib('crm'),editRules=await lib('customer-edit-requests');
const mold=await lib('mold-requests'),salesmen=await lib('mold-salesmen'),targets=await lib('targets'),baseline=await lib('kpi-baseline');
const support=await lib('support'),complaints=await lib('complaints'),queue=await lib('service-queue'),place=await lib('visit-place'),tracking=await lib('service-tracking');
const inactive=await lib('inactive-customers'),gate=await lib('tracking-gate'),companion=await lib('tracking-companion'),classification=await lib('customer-classification');
const moldRules=await import(pathToFileURL(path.join(root,'portable/mold-rules.mjs')));
const en=JSON.parse(fs.readFileSync(path.join(root,'lib/locales/en.json'),'utf8')),ARABIC=/[؀-ۿ]/;

// ---- 1. The rules.
const ROLES=['admin','manager','supervisor','rep','marketing','customer_service','customer_service_manager'];
eq(roles.MARKETING_ROLE,'marketing','the role key');
eq(ROLES.map(roles.isFieldRole),[false,false,false,true,true,false,false],'a field role: a representative or a marketing officer');
eq(ROLES.map(roles.isMarketingRole),[false,false,false,false,true,false,false],'a marketing officer only');
eq([...roles.FIELD_ROLES],['rep','marketing'],'the field roles');
eq(roles.FIELD_ROLES_SQL,"('rep','marketing')",'their SQL list');
eq(ROLES.map(roles.trackingRole),['admin','manager','supervisor','rep','rep','customer_service','customer_service_manager'],'the Android app (1.0.14) is told a marketing officer is a field member: rep');
eq([undefined,null,'','REP','Marketing',' marketing'].map(roles.isFieldRole),Array(6).fill(false),'nothing else is a field role');
eq(crmLib.roles.marketing,'مسؤول تسويق','the role in Arabic');
eq(en['مسؤول تسويق'],'Marketing officer','and in English');
eq(Object.keys(crmLib.roles),['admin','manager','supervisor','rep','marketing','customer_service_manager','customer_service'],'offered in the team screen\'s list right after the representative');

// The pages: a representative's, every one of them.
const VIEWS=['dashboard','customer','map','activity','complaints','service-kpi','followup','mold-requests','journeys','quote','sales','competitors','targets','team','trash','reports','factory','opportunity','service','unknown'];
eq(VIEWS.map(view=>access.canViewPage('marketing',view)),VIEWS.map(view=>access.canViewPage('rep',view)),'a marketing officer has exactly a representative\'s pages');
eq(VIEWS.map(view=>access.resolveCRMPage('marketing',view)),VIEWS.map(view=>access.resolveCRMPage('rep',view)),'and lands where a representative lands');
eq(access.canUseSalesWorkspace('marketing'),false,'no management workspace');
eq(access.trashScope('marketing'),null,'«المحذوفات» only through a «حذف» cell, as a representative');

// The team: under a supervisor, in the sales manager's team, alone otherwise.
const M=(id,role,supervisorId='',branch='الرئيسي',regionScope='eastern',active=1)=>({id,role,supervisorId,branch,regionScope,active,email:id+'@yourrest.org',name:id,target:0});
const members=[M('owner','admin','','الرئيسي','all'),M('mgr','manager','','الرئيسي','all'),M('sup','supervisor','mgr'),M('sup2','supervisor','mgr'),M('rep','rep','sup'),M('rep2','rep','sup2'),M('mkt','marketing','sup'),M('mkt2','marketing','sup2'),M('mktJ','marketing','sup','جدة'),M('cs','customer_service','csm'),M('csm','customer_service_manager','mgr')];
const byId=id=>members.find(member=>member.id===id),scope=(id,options)=>[...access.salesScopeMemberIds(members,byId(id),options)].sort();
eq(scope('sup'),['mkt','mktJ','rep','sup'],'a supervisor\'s team: their representatives and marketing officers');
eq(scope('sup2'),['mkt2','rep2','sup2'],'another supervisor\'s');
eq(scope('mgr'),['mgr','mkt','mkt2','mktJ','rep','rep2','sup','sup2'],'the sales manager\'s: supervisors and field members');
eq(scope('mkt'),['mkt'],'a marketing officer\'s: their own, as a representative');
eq(scope('rep'),['rep'],'a representative\'s: their own');
eq([...access.salesScopeMemberIds(members,{...byId('sup'),access:{version:1,off:[],hidden:[],viewAll:true}},{read:true})].includes('mkt2'),true,'«عرض بيانات الفريق بالكامل» reads every marketing officer too');

// Who corrects a customer's details, and who classifies it (the region boundary is the callers').
const C=(id,assignedTo,branch='الرئيسي')=>({id,kind:'customer',parentId:null,assignedTo,branch,data:{name:id,region:'الشرقية'},createdAt:'',updatedAt:'',version:1});
const customers={own:C('own','mkt'),rep:C('c-rep','rep'),rep2:C('c-rep2','rep2'),sup:C('c-sup','sup'),jeddah:C('c-jeddah','mktJ','جدة'),mgr:C('c-mgr','mgr')};
const matrix=(fn,who)=>Object.fromEntries(Object.entries(customers).map(([key,row])=>[key,fn(row,members,byId(who))]));
eq(matrix(access.canEditCustomerDetails,'mkt'),{own:true,rep:true,rep2:true,sup:true,jeddah:false,mgr:true},'a marketing officer corrects every customer of their branch, whoever it is assigned to; never another branch\'s');
eq(matrix(access.canEditCustomerDetails,'mktJ'),{own:false,rep:false,rep2:false,sup:false,jeddah:true,mgr:false},'the officer of Jeddah: Jeddah\'s only');
eq(matrix(access.canEditCustomerDetails,'rep'),{own:true,rep:true,rep2:true,sup:true,jeddah:true,mgr:true},'a representative proposes a correction for any customer of their regions, as before');
eq(matrix(access.canClassifyCustomer,'mkt'),{own:true,rep:true,rep2:true,sup:true,jeddah:false,mgr:true},'a marketing officer classifies every customer of their branch');
eq(matrix(access.canClassifyCustomer,'sup'),{own:true,rep:true,rep2:false,sup:true,jeddah:true,mgr:false},'a supervisor classifies their team\'s customers only');
eq(matrix(access.canClassifyCustomer,'mgr'),{own:true,rep:true,rep2:true,sup:true,jeddah:true,mgr:true},'the sales manager every one');
eq(matrix(access.canClassifyCustomer,'owner'),{own:true,rep:true,rep2:true,sup:true,jeddah:true,mgr:true},'the administrator every one');
for(const who of ['rep','rep2','cs','csm'])eq(Object.values(matrix(access.canClassifyCustomer,who)),Array(6).fill(false),who+' never classifies');
eq(access.canClassifyCustomer({...customers.rep,kind:'factory'},members,byId('mgr')),false,'only a customer is classified');
eq(access.canManageMasterRecord(customers.rep,members,byId('mkt')),true,'a customer\'s details are a field member\'s to correct (routing stays locked by the route)');
eq(access.canEditMachineRecord({id:'m',kind:'factory',parentId:'own',assignedTo:'mkt',branch:'الرئيسي',data:{}},members,byId('mkt')),true,'a marketing officer\'s own customer\'s machines');
eq(access.canEditMachineRecord({id:'m',kind:'factory',parentId:'c-rep',assignedTo:'rep',branch:'الرئيسي',data:{}},members,byId('mkt')),false,'never another\'s machines, as a representative');
const visitOf=author=>({id:'v-'+author,kind:'activity',parentId:'own',assignedTo:'mkt',branch:'الرئيسي',data:{performedBy:author},createdAt:'',updatedAt:'',version:1});
eq(['mkt','sup','mgr','owner','rep','sup2','mkt2'].map(who=>access.canReadSalesRecord(visitOf('mkt'),members,byId(who))),[true,true,true,true,false,false,false],'a marketing officer\'s visit: theirs, their supervisor\'s, the sales manager\'s; never a colleague\'s');
const view=access.salesRecordAccess(members,byId('mkt'));
eq([view.canClassify(customers.rep),view.canClassify(customers.jeddah),view.canEditCustomerDetails(customers.jeddah)],[true,false,false],'the projection says the same');

// What GET /api/crm sends: markers, and a representative never reads another's classifications.
const classified={opportunityGrade:'A',gradeNotes:'طلب عرض سعر',factorySize:'B',customerInterest:'price'};
const rows=[{...customers.rep,data:{...customers.rep.data,...classified}},{...customers.jeddah,data:{...customers.jeddah.data,...classified}},{...customers.own,data:{...customers.own.data,...classified}}];
const projected=(who)=>Object.fromEntries(crmLib.scopeRecords(rows,members,byId(who)).map(row=>[row.id,row.data]));
let p=projected('mkt');
eq([p['c-rep']._masterReadOnly,p['c-rep']._classificationReadOnly,p['c-rep'].opportunityGrade],[undefined,undefined,'A'],'a marketing officer: their branch\'s customer is open to them, with its classifications');
eq([p['c-jeddah']._masterReadOnly,p['c-jeddah']._classificationReadOnly,p['c-jeddah'].factorySize],[true,true,'B'],'another branch\'s: read only, classifications shown');
p=projected('rep');
eq([p['c-rep'].opportunityGrade,p['c-rep']._classificationReadOnly,p['own'].opportunityGrade,p['own'].gradeNotes],['A',true,undefined,undefined],'a representative reads the classifications of their own customers only, read only');
eq(Object.keys(classified).every(key=>!(key in p['c-jeddah'])),true,'nothing of another\'s customer\'s classifications reaches a representative');
p=projected('sup');
eq([p['c-rep']._classificationReadOnly,p['own']._classificationReadOnly,p['c-jeddah']._classificationReadOnly],[undefined,undefined,undefined],'a supervisor classifies their team\'s customers (the marketing officers\' included)');
eq(projected('mgr')['c-jeddah'].customerInterest,'price','the sales manager reads them all');

// The permissions matrix: a representative's cells, «حذف عميل» excepted.
const KEYS=permissions.PERMISSION_MATRIX.flatMap(row=>permissions.PERMISSION_ACTIONS.filter(action=>row.cells[action]).map(action=>[row.screen,action]));
const differs=KEYS.filter(([screen,action])=>permissions.cellCeiling('marketing',screen,action)!==permissions.cellCeiling('rep',screen,action)).map(cell=>cell.join(':'));
eq(differs,['customer:delete'],'every cell is a representative\'s but «حذف عميل»');
eq([permissions.cellCeiling('marketing','customer','edit'),permissions.cellCeiling('marketing','customer','add'),permissions.cellCeiling('marketing','activity','delete'),permissions.cellCeiling('marketing','followup','delete'),permissions.cellCeiling('marketing','trash','edit')],[true,true,true,true,true],'edit and add customers; «حذف» of their own visits and follow-ups grantable; restoring their own');
eq(permissions.normalizePermissions('marketing',{cells:{'customer:delete':true,'activity:delete':true}}).cells['customer:delete'],undefined,'«حذف عميل» cannot even be saved for the role');
eq(permissions.can({role:'marketing',access:permissions.memberAccess('marketing',{permissions:JSON.stringify({'customer:delete':true}),hidden:'[]',version:2})},'customer','delete'),false,'nor granted by a stored cell');
eq(permissions.trashScopeOf({role:'marketing',access:permissions.memberAccess('marketing',{permissions:JSON.stringify({'activity:delete':true}),hidden:'[]',version:2})}),'own','«المحذوفات» with «حذف زيارة», their own deletions');
eq(permissions.trashScopeOf({role:'marketing',access:permissions.memberAccess('marketing',null)}),null,'none by default');
ok(permissions.permissionRow('customer').cells.edit.roleNote.marketing.ar.includes('مباشرةً'),'the matrix explains the direct correction for the role');
ok(!ARABIC.test(permissions.permissionRow('customer').cells.edit.roleNote.marketing.en),'and in English');
eq(permissions.viewAllAvailable('marketing'),false,'no «عرض بيانات الفريق بالكامل»');
eq(permissions.copyPermissions({role:'rep',stored:permissions.normalizePermissions('rep',{cells:{'customer:delete':true}})},'marketing').skipped,['customer:delete'],'copying a representative\'s «حذف عميل» to a marketing officer is skipped and named');

// Corrections: direct, never a request; the classifications are request fields only for whom may send one (the supervisor).
eq(['marketing','rep','supervisor','customer_service','manager','admin'].map(editRules.proposesCustomerEdit),[false,true,true,true,false,false],'a marketing officer never sends a request');
eq(editRules.directCustomerEditRole('marketing'),false,'and decides none');
for(const field of classification.CLASSIFICATION_FIELDS)ok(editRules.CUSTOMER_EDIT_FIELDS.includes(field),field+' can travel in a supervisor\'s request');
eq(editRules.customerEditProposal({name:'x',opportunityGrade:'B'},{name:'x',opportunityGrade:'A',factorySize:'D'}).fields,['opportunityGrade','factorySize'],'a change of classification is a request field');
eq(editRules.CUSTOMER_EDIT_CODE_FIELDS.has('factorySize'),true,'shown with its words in the list of requests');
eq(editRules.activeSupervisorOf('mkt',members),undefined,'nothing of a marketing officer waits for a supervisor');

// Mold requests and the products application's salesmen.
eq(mold.canUseMoldRequests('marketing'),true,'a marketing officer files mold requests');
eq(moldRules.moldSignatureRequired('marketing'),true,'with the customer\'s signature, as a representative');
eq(mold.moldTeamManagerId('mkt',members),'mgr','in their sales manager\'s team, through their supervisor');
eq(salesmen.moldSalesmanMayAsk({id:'mkt',name:'مسؤول تسويق تجريبي',email:'mkt@yourrest.org',role:'marketing',active:1}),true,'and is sent to the products application as a salesman');
eq(salesmen.moldSalesmanMayAsk({id:'mkt',name:'مسؤول تسويق تجريبي',email:'mkt@yourrest.org',role:'marketing',active:0}),false,'not while deactivated');
eq(salesmen.moldSalesmanMayAsk({id:'mkt',name:'مسؤول تسويق تجريبي',email:'mkt@yourrest.org',role:'marketing',active:1,access:permissions.memberAccess('marketing',{permissions:JSON.stringify({'mold-requests:add':false}),hidden:'[]',version:3})}),false,'nor with «إضافة» switched off');

// Targets and the evaluation: a representative's.
eq(targets.managerTeam(byId('sup'),members).map(member=>member.id).sort(),['mkt','mktJ','rep'],'a supervisor\'s team for the targets');
eq(targets.managerTeam(byId('mgr'),members).map(member=>member.id).sort(),['mkt','mkt2','mktJ','rep','rep2','sup','sup2'],'the sales manager\'s');
const quantity=(id,n)=>({kind:'sales',scopeId:id,month:'2026-11',version:1,updatedAt:'',data:{products:targets.targetProducts.map(product=>({product:product.id,quantity:n}))}});
const computed=targets.withManagerTargets({month:'2026-11',sets:[quantity('rep',2),quantity('mkt',3),quantity('mktJ',4)],branches:[]},members).sets.find(set=>set.scopeId==='sup'&&set.kind==='sales');
eq([computed.teamMemberIds.sort(),computed.data.products[0].quantity],[['mkt','mktJ','rep'],9],'a supervisor\'s sales target adds up their marketing officers\' as their representatives\'');
eq(targets.roleOutOfEvaluation('marketing'),false,'a marketing officer is evaluated');
eq(baseline.outOfEvaluation('marketing','2026-10','2026-10-31','2026-11-18',true,new Set()),baseline.outOfEvaluation('rep','2026-10','2026-10-31','2026-11-18',true,new Set()),'a month without work: out of the evaluation as a representative');
eq(baseline.outOfEvaluation('marketing','2026-10','2026-10-31','2026-11-18',true,new Set()),true,'(the mark itself)');
eq(inactive.inactiveAlertMode({role:'marketing'}),'own','«عملاؤك اللي ما اشتروش»: their own, as a representative');

// Support requests, complaints, customer-service requests and the visit place.
eq([support.supportReader({me:byId('mkt'),members}).rep,support.supportReader({me:byId('mkt'),members}).sales],[true,true],'support: a sales field member');
eq(complaints.complaintReader({me:byId('mkt'),members}).rep,true,'complaints: a field member');
const supportCustomer={id:'c',kind:'customer',parentId:null,assignedTo:'mkt',branch:'الرئيسي',data:{region:'الشرقية'}};
eq(support.supportCandidates({id:'s',data:{assigneeId:'',handlerId:''}},supportCustomer,{me:byId('sup'),members},'delegate').map(person=>person.id),['mkt','rep'],'a supervisor delegates a support request to their marketing officer (the customer\'s own first)');
eq(complaints.complaintCandidates({id:'k',data:{assigneeId:''}},supportCustomer,{me:byId('mgr'),members},'assign').map(person=>person.id).sort(),['mkt','mkt2','rep','rep2','sup','sup2'],'the sales manager assigns a complaint to a marketing officer of the branch');
const entry=(awaiting,stage='first_contact')=>({id:awaiting||stage,stage,awaiting});
eq(queue.queueGroups([entry('first_contact'),entry(null,'follow_up'),entry(null,'closed')],'marketing'),queue.queueGroups([entry('first_contact'),entry(null,'follow_up'),entry(null,'closed')],'rep'),'customer-service requests are grouped as a representative\'s');
const far={customer:{name:'مصنع',location:'26.4,50.1',latitude:26.4,longitude:50.1},data:{type:'visit',latitude:24.7,longitude:46.7,locationAccuracy:10},language:'ar'};
eq([place.visitPlaceView({...far,role:'marketing'}).blocked,place.visitPlaceView({...far,role:'rep'}).blocked,place.visitPlaceView({...far,role:'supervisor'}).blocked],[true,true,false],'a visit recorded away from the customer waits for a marketing officer as for a representative');
eq(tracking.trackingHolderLabels.marketing,['مسؤول تسويق','marketing officer'],'the tracking board names a marketing officer who holds a request');
eq(gate.trackingGateDecision({role:'marketing',active:1,native:false}).status,'blocked','the tracking gate holds a marketing officer outside the app, as a representative');
eq(companion.companionDecision({role:'marketing',native:true,ownDayId:null,serverDay:{id:'d',endedAt:null},serverKnown:true,windowOpen:true,rememberedAt:null,now:Date.now()}).companion,true,'a second device of a marketing officer is a companion');

// The classifications' words and the server's refusals in English, with no Arabic left.
for(const text of [classification.CLASSIFICATION_REFUSED,classification.GRADE_REFUSED,classification.SIZE_REFUSED,classification.INTEREST_REFUSED,classification.GRADE_NOTES_TOO_LONG])ok(en[text]&&!ARABIC.test(en[text]),'English for: '+text);
const server=fs.readFileSync(path.join(root,'lib/crm-server.ts'),'utf8');
for(const name of ['MARKETING_NO_CUSTOMER_DELETE','MARKETING_OTHER_BRANCH']){const text=server.match(new RegExp('export const '+name+"='([^']+)'"))[1];ok(en[text]&&!ARABIC.test(en[text]),'English for: '+text);}

// The guard: every literal 'rep' left in lib/ and app/ names a representative alone for a reason listed here, or sits on a line that names
// the marketing officer too. A new check written for 'rep' fails here until it is decided for the marketing officer.
const KEEP=[
 ['lib/roles.ts','',"the field roles' own definition"],
 ['lib/crm-server.ts',"c.me.role==='rep'&&record.kind==='customer'","after the marketing officer's own guard (marketingCustomerGuard, and the refused deletion) above it"],
 ['lib/crm.ts',"me.role==='rep'&&row.assignedTo!==me.id",'a representative reads the classifications of their own customers only'],
 ['lib/access.ts',"me.role==='rep'||",'a representative corrects any customer of their regions through a request; the marketing officer is bound to their branch on the same line'],
 ['lib/customer-edit-requests.ts',"['rep','supervisor','customer_service','customer_service_manager']",'who sends a request: a marketing officer edits directly'],
 ['lib/customer-edit-requests.ts',"requester.role!=='rep'",'only a representative\'s request waits for a supervisor; a marketing officer sends none'],
 ['lib/customer-edit-requests-server.ts',"ce_rq.role='rep'",'the same rule as activeSupervisorOf, at commit'],
 ['lib/service-tracking.ts',"assigneeRole==='rep'?'rep'",'the holder\'s words: a marketing officer has their own on the same line'],
 ['lib/service-tracking.ts',"'supervisor'|'rep'|",'the holder roles: marketing on the same line'],
 ['lib/nearby-customers.ts',"memberRole:'rep'",'the role the Android app checks for every field member'],
 ['lib/nearby-customers.ts',"always 'rep'",'its comment'],
 ['lib/support.ts',"SupportOrigin='rep'",'the origin of a support request (from sales), not a role'],
 ['lib/service-tracking.ts',"origin:'rep'",'the origin of a support request, not a role'],
 ['app/api/support/route.ts',"'rep'",'the origin of a support request, not a role'],
 ['app/support-panel.tsx',"origin:'rep'",'the origin of a support request, not a role'],
 ['app/opportunity-support.tsx',"origin:'rep'",'the origin of a support request, not a role'],
 ['lib/erp-collections.ts',"'rep'",'a column of the ERP collections statement, not a role'],
 ['lib/service-kpi.ts',"'rep'",'the customer-service representative\'s evaluation card, not a sales role'],
 ['app/service-kpi.tsx','rep','the customer-service representative\'s evaluation card, not a sales role'],
 ['app/device-status-reporter.tsx',"trackingGateDecision({role:'rep'",'the device report is built for a field member (memberId is a field member\'s only)'],
 ['app/team-today.tsx',"row.role!=='rep'",'the role under the name for everyone but a representative: a marketing officer\'s is shown'],
 ['app/crm-app.tsx',"role: 'rep', branch",'a new member\'s first choice in the team form'],
 ['app/crm-app.tsx',"data-customer-edit-note>{me?.role==='rep'",'the note of a request going to the supervisor first: a representative\'s only'],
 ['app/crm-app.tsx',"me?.role==='rep'&&form.row.assignedTo!==me.id",'a representative reads the classifications of their own customers only'],
 ['app/crm-app.tsx',"me?.role === 'rep' && detail.assignedTo !== me.id",'the same, on the customer\'s sheet'],
];
const files=dir=>fs.readdirSync(path.join(root,dir),{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path.join(dir,entry.name)):/\.(ts|tsx)$/.test(entry.name)?[path.join(dir,entry.name)]:[]);
const unexplained=[];
for(const file of [...files('lib'),...files('app')]){
 fs.readFileSync(path.join(root,file),'utf8').split('\n').forEach((line,index)=>{
  if(!/'rep'|"rep"/.test(line)||/marketing/.test(line))return;
  if(!KEEP.some(([keepFile,snippet])=>keepFile===file&&line.includes(snippet)))unexplained.push(file+':'+(index+1)+' '+line.trim().slice(0,160));
 });
}
eq(unexplained,[],'every literal \'rep\' of lib/ and app/ is decided for the marketing officer (lib/roles.ts) or listed with its reason');
const sqlRep=[...files('lib'),...files('app')].flatMap(file=>fs.readFileSync(path.join(root,file),'utf8').split('\n').filter(line=>/role\s*=\s*'rep'|role IN \('rep'/.test(line)).map(line=>file+': '+line.trim().slice(0,100)));
eq(sqlRep.map(line=>line.split(':')[0]),['lib/customer-edit-requests-server.ts'],'no SQL names the representative alone but the request\'s supervisor step');

// ---- 2. The routes on a real SQLite with the real migrations.
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+f,'utf8'));
class Statement{constructor(q,a=[]){this.q=q;this.a=a;}bind(...a){return new Statement(this.q,a);}async run(){const r=sql.prepare(this.q).run(...this.a);return{meta:{changes:Number(r.changes)}};}async all(){return{results:sql.prepare(this.q).all(...this.a)};}async first(){return sql.prepare(this.q).get(...this.a)||null;}}
let pending=Promise.resolve();
const DB={prepare:q=>new Statement(q),batch:statements=>{const run=pending.then(async()=>{sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}});pending=run.catch(()=>{});return run;}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid'};
const now=new Date().toISOString();
const member=(id,role,sup=null,region='eastern',branch='الرئيسي')=>sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,1,0,?)').run(id,'u-'+id,id+'@yourrest.org','اسم '+id,role,branch,sup,region,now);
member('owner','admin',null,'all');member('mgr','manager',null,'all');member('sup','supervisor','mgr');member('sup2','supervisor','mgr');
member('rep','rep','sup');member('rep2','rep','sup2');member('mkt','marketing','sup');member('mktJ','marketing','sup','eastern','جدة');member('mktW','marketing','mgr','western');
member('csm','customer_service_manager','mgr');member('cs','customer_service','csm');
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-owner')").run();
const user=id=>{globalThis.testUser=id?{userId:'u-'+id,email:id+'@yourrest.org',fullName:id}:null;};
const crm=await import(pathToFileURL(path.join(out,'app/api/crm/route.mjs')));
const raw=id=>sql.prepare('SELECT * FROM crm_records WHERE id=?').get(id),row=id=>({...raw(id),data:JSON.parse(raw(id).data)});
const customer=(id,assignedTo,extra={},region='الشرقية',branch='الرئيسي')=>{const data={name:'مصنع '+id,region,assignedTo,branch,location:'26.437341, 50.034499',phone:'0500000000',city:'الدمام',code:'ERP-'+id,...extra};sql.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,'customer',NULL,?,?,?,?,?,1)").run(id,assignedTo,branch,JSON.stringify(data),now,now);};
customer('c-rep','rep');customer('c-rep2','rep2');customer('c-sup','sup');customer('c-mkt','mkt');customer('c-jeddah','mktJ',{},'الشرقية','جدة');customer('c-west','mktW',{},'الغربية');
const machine=(id,parent,assignedTo,quantity,recordType='machine')=>sql.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,'factory',?,?,'الرئيسي',?,?,?,1)").run(id,parent,assignedTo,JSON.stringify({name:id,recordType,quantity,machineBrand:'X',modelCondition:'new'}),now,now);
machine('m1','c-rep','rep',2);machine('m2','c-rep','rep',null);
const request=(body,origin='https://test.invalid')=>new Request('https://test.invalid/api/crm',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
const post=async(who,body,status=200)=>{user(who);const res=await crm.POST(request(body)),data=await res.json();eq(res.status,status,who+' '+JSON.stringify(body).slice(0,140)+' -> '+JSON.stringify(data));return data;};
const read=async who=>{user(who);const res=await crm.GET();eq(res.status,200,'GET /api/crm as '+who);return res.json();};
const edit=(id,extra={},editKey=crypto.randomUUID())=>{const value=row(id);return {action:'save',kind:'customer',id,version:value.version,editKey,data:{...value.data,assignedTo:value.assigned_to,branch:value.branch,...extra}};};
const waiting=id=>sql.prepare("SELECT q.id,q.detail FROM crm_audit q WHERE q.record_id=? AND q.action='customer-edit:request' AND NOT EXISTS (SELECT 1 FROM crm_audit d WHERE d.id='customer-edit-decision:'||q.id)").all(id).map(r=>({id:r.id,...JSON.parse(r.detail)}));
const audits=(id,action)=>sql.prepare('SELECT action,actor,detail FROM crm_audit WHERE record_id=? AND action=? ORDER BY created_at,rowid').all(id,action);
const without=(data,keys)=>{const copy={...data};for(const key of keys)delete copy[key];return copy;};

// A marketing officer corrects another representative's customer of their branch directly: no request, the history names them.
let before=row('c-rep2');
let saved=await post('mkt',edit('c-rep2',{phone:'0512345678',city:'الخبر',notes:'تحديث التسويق'}));
eq([saved.ok,saved.id,saved.pendingApproval],[true,'c-rep2',undefined],'saved directly: no approval waits');
eq([row('c-rep2').data.phone,row('c-rep2').data.city,row('c-rep2').data.notes,row('c-rep2').version],['0512345678','الخبر','تحديث التسويق',before.version+1],'the customer changed at once');
eq(waiting('c-rep2').length,0,'nothing waits for a supervisor or the sales manager');
eq(audits('c-rep2','تعديل').map(a=>a.actor),['اسم mkt'],'the customer\'s history records who changed it (and when: created_at)');
eq([row('c-rep2').assigned_to,row('c-rep2').branch,row('c-rep2').data.code],['rep2','الرئيسي','ERP-c-rep2'],'the routing and the ERP code stay');
await post('mkt',edit('c-sup',{city:'القطيف'}));eq(row('c-sup').data.city,'القطيف','a supervisor\'s customer of the branch too');
await post('mkt',edit('c-mkt',{city:'الجبيل'}));eq(row('c-mkt').data.city,'الجبيل','their own customer');
// The limits: another branch, another region, the routing, a deletion, a stale version, another site.
before=JSON.stringify(raw('c-jeddah'));
eq((await post('mkt',edit('c-jeddah',{city:'جدة'}),403)).error,'يعدّل مسؤول التسويق بيانات عملاء فرعه فقط.','another branch\'s customer: refused');
eq(JSON.stringify(raw('c-jeddah')),before,'and unchanged');
await post('mkt',edit('c-west',{city:'جدة'}),404);
await post('mkt',edit('c-rep',{assignedTo:'mkt'}),403);await post('mkt',edit('c-rep',{branch:'جدة'}),403);
eq(row('c-rep').assigned_to,'rep','the routing never moves');
eq((await post('mkt',{action:'delete',kind:'customer',id:'c-mkt',version:row('c-mkt').version},403)).error,'غير مسموح لك بالحذف في العملاء. راجع مدير النظام.','a marketing officer never deletes a customer, not even their own');
await post('owner',{action:'permissions',memberId:'mkt',version:0,cells:{'customer:delete':true,'activity:delete':true},hidden:[],viewAll:false});
await post('mkt',{action:'delete',kind:'customer',id:'c-mkt',version:row('c-mkt').version},403);
ok(raw('c-mkt'),'the switch cannot grant it: the customer stays');
await post('mkt',{...edit('c-rep2',{city:'الدمام'}),version:1},409);eq(row('c-rep2').data.city,'الخبر','a save on a stale version changes nothing');
user('mkt');eq((await crm.POST(request(edit('c-rep2',{city:'سيهات'}),'https://evil.example'))).status,403,'from another site: 403');
await post('mkt',{action:'save',kind:'opportunity',id:null,parentId:'c-rep',data:{}},403);
// Machines: their own customers only, as a representative.
await post('mkt',{action:'save',kind:'factory',parentId:'c-mkt',data:{name:'خط ١',recordType:'machine',quantity:1,machineBrand:'X',modelCondition:'new'}});
await post('mkt',{action:'save',kind:'factory',parentId:'c-rep2',data:{name:'خط ٢',recordType:'machine',quantity:1,machineBrand:'X',modelCondition:'new'}},403);

// The classifications.
const values={opportunityGrade:'A',gradeNotes:'صاحب القرار طلب عرض سعر',factorySize:'B',customerInterest:'technical'};
await post('mkt',edit('c-rep2',values));
eq(['opportunityGrade','gradeNotes','factorySize','customerInterest'].map(field=>row('c-rep2').data[field]),['A','صاحب القرار طلب عرض سعر','B','technical'],'a marketing officer sets the four directly');
eq(waiting('c-rep2').length,0,'with no request');
await post('mkt',edit('c-rep2',{factorySize:'D'}));eq(row('c-rep2').data.factorySize,'D','«متوقف» by hand');
await post('mkt',edit('c-rep2',{factorySize:''}));eq('factorySize' in row('c-rep2').data,false,'emptied: nothing stored (the suggestion shows again)');
for(const [field,bad,message] of [['opportunityGrade','E','اختر تصنيف الفرصة من القائمة: A أو B أو C أو D'],['opportunityGrade','a','اختر تصنيف الفرصة من القائمة: A أو B أو C أو D'],['factorySize','كبير','اختر حجم المصنع من القائمة: A أو B أو C أو D'],['customerInterest','cheap','اختر اهتمام العميل من القائمة: فني أو سعري أو خدمي أو الثقة'],['customerInterest',3,'اختر اهتمام العميل من القائمة: فني أو سعري أو خدمي أو الثقة'],['gradeNotes','س'.repeat(1001),'ملاحظات التصنيف طويلة؛ الحد الأقصى 1000 حرف.']]){
 eq((await post('mkt',edit('c-rep2',{[field]:bad}),400)).error,message,'refused: '+field+' '+JSON.stringify(bad).slice(0,12));
}
await post('mkt',edit('c-rep2',{opportunityGrade:' C ',gradeNotes:'  ملاحظة  '}));eq([row('c-rep2').data.opportunityGrade,row('c-rep2').data.gradeNotes],['C','ملاحظة'],'trimmed before it is checked');
// A save that does not carry them keeps them (a page opened before them, a representative's view without them).
await post('mkt',{...edit('c-rep2'),data:without(edit('c-rep2').data,['opportunityGrade','gradeNotes','customerInterest']),});
eq([row('c-rep2').data.opportunityGrade,row('c-rep2').data.customerInterest],['C','technical'],'absent fields keep the stored values');
// A representative: read only. A save that changes one is refused; a correction that leaves them keeps them out of its request.
eq((await post('rep',edit('c-rep',{opportunityGrade:'A'}),403)).error,classification.CLASSIFICATION_REFUSED,'a representative cannot set a classification');
await post('rep',edit('c-rep2',{factorySize:'A'}),403);
eq(waiting('c-rep').length+waiting('c-rep2').length,0,'and nothing waits');
let sent=await post('rep',edit('c-rep2',{phone:'0599999999'}));
eq([sent.pendingApproval,waiting('c-rep2')[0].fields],[true,['phone']],'a representative\'s correction carrying the stored classifications asks for the phone only');
await post('rep',{action:'customer-edit',decision:'cancel',id:sent.requestId});
sent=await post('rep',{...edit('c-rep2',{phone:'0588888888'}),data:without(edit('c-rep2',{phone:'0588888888'}).data,classification.CLASSIFICATION_FIELDS)});
eq(waiting('c-rep2')[0].fields,['phone'],'nor when it carries none (what a representative reads of another\'s customer)');
await post('rep',{action:'customer-edit',decision:'cancel',id:sent.requestId});
// Customer service: read only.
await post('cs',edit('c-rep',{customerInterest:'price'}),403);
// A supervisor: their team's customers, the change waiting in their request as every correction of theirs; the sales manager approves it.
sent=await post('sup',edit('c-rep',{opportunityGrade:'B',factorySize:'A',customerInterest:'service'}));
eq([sent.pendingApproval,sent.approvalStage,row('c-rep').data.opportunityGrade],[true,'sales_manager',undefined],'a supervisor\'s classification waits for the sales manager');
eq(waiting('c-rep')[0].fields.sort(),['customerInterest','factorySize','opportunityGrade'],'the request carries it');
eq((await post('mgr',{action:'customer-edit',decision:'approve',id:sent.requestId})).status,'approved','the sales manager approves');
eq(['opportunityGrade','factorySize','customerInterest'].map(field=>row('c-rep').data[field]),['B','A','service'],'applied');
await post('sup',edit('c-rep2',{opportunityGrade:'D'}),403);
eq(row('c-rep2').data.opportunityGrade,'C','another team\'s customer: refused');
// The sales manager and the administrator: directly.
await post('mgr',edit('c-jeddah',{opportunityGrade:'B'}));eq(row('c-jeddah').data.opportunityGrade,'B','the sales manager, directly');
await post('owner',edit('c-west',{customerInterest:'trust'}));eq(row('c-west').data.customerInterest,'trust','the administrator, directly');
eq([waiting('c-jeddah').length,waiting('c-west').length],[0,0],'neither waits');
await post('mkt',edit('c-jeddah',{opportunityGrade:'A'}),403);eq(row('c-jeddah').data.opportunityGrade,'B','a marketing officer never classifies another branch\'s customer');

// What each reads (GET /api/crm).
let data=await read('rep');
const repSees=id=>data.records.find(record=>record.id===id)?.data;
eq([repSees('c-rep').opportunityGrade,repSees('c-rep')._classificationReadOnly],['B',true],'a representative reads their own customer\'s classifications, read only');
eq(['opportunityGrade','gradeNotes','factorySize','customerInterest'].some(field=>field in repSees('c-rep2')),false,'and nothing of another\'s');
data=await read('mkt');
eq([repSees('c-rep2').opportunityGrade,repSees('c-rep2')._classificationReadOnly,repSees('c-jeddah')._classificationReadOnly,repSees('c-jeddah')._masterReadOnly],['C',undefined,true,true],'a marketing officer: their branch open, another branch read only');
eq(data.me.role,'marketing','the page knows the role');
eq(data.audits.every(audit=>!['c-rep2','c-sup'].includes(audit.recordId)||audit.action!=='تعديل'),true,'the recent changes of a field member list their visits only, as a representative\'s');
data=await read('mgr');
ok(data.audits.some(audit=>audit.recordId==='c-rep2'&&audit.action==='تعديل'&&audit.actor==='اسم mkt'),'the sales manager reads the marketing officer\'s correction in the history');

// A new customer: a marketing officer's own, classified; saved on the device first (the offline queue replays the same body).
const createKey=crypto.randomUUID(),capturedAt=new Date(Date.now()-60_000).toISOString().replace(/\.\d+Z$/,'.000Z');
saved=await post('mkt',{action:'save',kind:'customer',createKey,offline:{memberId:'mkt',capturedAt},data:{name:'مصنع التسويق الجديد',region:'الشرقية',city:'الدمام',phone:'0501231234',customerKind:'مصنع',opportunityGrade:'B',factorySize:'D',customerInterest:'trust',gradeNotes:'قيد الدراسة',branch:'آخر',assignedTo:'rep'}});
const fresh=row(saved.id);
eq([fresh.assigned_to,fresh.branch,fresh.data.opportunityGrade,fresh.data.factorySize,fresh.data.customerInterest,fresh.data.gradeNotes,fresh.data.offlineRecordedAt],['mkt','الرئيسي','B','D','trust','قيد الدراسة',capturedAt],'saved on the device: the marketing officer\'s own, with its classifications and the device\'s time');
eq((await post('mkt',{action:'save',kind:'customer',createKey,offline:{memberId:'mkt',capturedAt},data:{name:'مصنع التسويق الجديد',region:'الشرقية',city:'الدمام',phone:'0501231234',customerKind:'مصنع',opportunityGrade:'B',factorySize:'D',customerInterest:'trust',gradeNotes:'قيد الدراسة',branch:'آخر',assignedTo:'rep'}})).alreadySaved,true,'the queue\'s replay is one customer');
eq((await post('rep',{action:'save',kind:'customer',createKey:crypto.randomUUID(),data:{name:'مصنع مندوب جديد',region:'الشرقية',city:'الدمام',phone:'0501231299',opportunityGrade:'A'}},403)).error,classification.CLASSIFICATION_REFUSED,'a representative\'s new customer cannot carry a classification');
saved=await post('rep',{action:'save',kind:'customer',createKey:crypto.randomUUID(),data:{name:'مصنع مندوب جديد',region:'الشرقية',city:'الدمام',phone:'0501231299',opportunityGrade:'',factorySize:''}});
eq(['opportunityGrade','factorySize'].some(field=>field in row(saved.id).data),false,'empty ones are no classification');

// The team screen: a member of the new role, under a supervisor.
const memberBody={name:'مسؤول تسويق تجريبي',email:'new.marketing@yourrest.org',role:'marketing',branch:'الرئيسي',supervisorId:'sup',regionScope:['eastern'],active:1,target:0};
await post('mgr',{action:'member',data:memberBody},403);
await post('owner',{action:'member',data:memberBody});
const created=sql.prepare("SELECT role,supervisor_id AS sup,region_scope AS region FROM crm_members WHERE email='new.marketing@yourrest.org'").get();
eq({...created},{role:'marketing',sup:'sup',region:'eastern'},'the administrator adds a marketing officer under a supervisor');
await post('owner',{action:'member',data:{...memberBody,email:'bad.marketing@yourrest.org',supervisorId:'cs'}},400);
await post('owner',{action:'member',data:{...memberBody,email:'odd@yourrest.org',role:'marketer'}},400);

console.log(JSON.stringify({ok:true,checks,realSqlite:true,productionDataUsed:false}));
