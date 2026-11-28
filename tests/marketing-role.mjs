// «مسؤول تسويق» (the owner, 2026-11-18: «فيه وظيفة جديدة مسؤول تسويق ... بيشتغل زى المندوب»; lib/roles.ts) and the customer
// classifications (lib/customer-classification.ts, as the owner corrected them the same day: «اهتمام العميل» set by hand, the size
// computed, the opportunity grade on each visit), without a build. 1. The rules, on the real modules: the role is a field role
// everywhere a representative is named (pages, team and supervisor, tracking and the Android app's role, targets and evaluation, mold
// requests and the products application's salesmen, support and complaints, the visit place), the permissions matrix (a representative's
// cells, never «حذف عميل»), who corrects and who classifies which customer, and a guard over the sources: every remaining literal 'rep'
// of lib/ and app/ is listed here with the reason it stays a representative's alone (a new check written for 'rep' fails it until it is
// decided for the marketing officer too). 2. POST /api/crm and GET /api/crm on an isolated in-memory SQLite (the real migrations): the
// marketing officer corrects another representative's customer of their branch directly (no request; the history keeps every changed
// field before and after), another branch's customer of their regions and any change of a customer's region through a request as a
// representative's (the review of 2026-11-18), never another region's, the routing or a deletion; «اهتمام العميل» by role (a
// representative and customer service refused, a supervisor's waiting in their request, the sales manager's and the administrator's
// direct), an unknown value refused, null empty, a save without it keeping it; the retired grade, notes and size never set by hand and
// what the release before stored carried untouched by every save (a marketing officer's, a manager's with null, a representative's
// request, an old request approved now); hidden (with a marker) from a representative for another's customer and from a marketing officer
// for another branch's; a new customer saved on the device with its interest and none of the retired values; the team screen's member of
// the new role. Synthetic people and customers only; no network.
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
eq(matrix(access.canEditCustomerDetails,'mkt'),{own:true,rep:true,rep2:true,sup:true,jeddah:true,mgr:true},'a marketing officer corrects every customer of their regions, as a representative (another branch\'s through a request: the review of 2026-11-18)');
eq(matrix(access.canEditCustomerDetails,'mktJ'),{own:true,rep:true,rep2:true,sup:true,jeddah:true,mgr:true},'the officer of Jeddah too');
// What waits (lib/customer-edit-requests.ts marketingCorrectionWaits): another branch's customer only; since 2026-11-28 (the owner: «عايز ادى
// صلاحية تغيير المنطقة للمسوق») a change of their branch's customer's region is saved directly (the server bounds the new region).
const mkt=byId('mkt');
eq([editRules.marketingCorrectionWaits(mkt,customers.rep),editRules.marketingCorrectionWaits(mkt,customers.jeddah)],[false,true],'a marketing officer: their branch\'s customer directly, whatever its region; another branch\'s waits');
eq(['rep','supervisor','manager','admin','customer_service'].map(role=>editRules.marketingCorrectionWaits({role,branch:'الرئيسي'},customers.jeddah)),[false,false,false,false,false],'the rule is the marketing officer\'s alone (the others have their own)');
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
eq([view.canClassify(customers.rep),view.canClassify(customers.jeddah),view.canEditCustomerDetails(customers.jeddah)],[true,false,true],'the projection says the same');
// Whose classifications a reader does not read (lib/customer-classification.ts classificationHiddenFrom).
eq(['own','rep','jeddah'].map(key=>classification.classificationHiddenFrom(byId('mkt'),customers[key])),[false,false,true],'a marketing officer: another branch\'s');
eq(['own','rep','jeddah'].map(key=>classification.classificationHiddenFrom(byId('rep'),customers[key])),[true,false,true],'a representative: every customer not assigned to them');
eq(['sup','mgr','owner','cs','csm','mktJ'].map(who=>classification.classificationHiddenFrom(byId(who),customers.rep)),[false,false,false,false,false,true],'nobody else\'s are hidden, but the Jeddah officer\'s of the main branch');

// What GET /api/crm sends: markers, and a representative never reads another's classifications.
const classified={opportunityGrade:'A',gradeNotes:'طلب عرض سعر',factorySize:'B',customerInterest:'price'};
const rows=[{...customers.rep,data:{...customers.rep.data,...classified}},{...customers.jeddah,data:{...customers.jeddah.data,...classified}},{...customers.own,data:{...customers.own.data,...classified}}];
const projected=(who)=>Object.fromEntries(crmLib.scopeRecords(rows,members,byId(who)).map(row=>[row.id,row.data]));
let p=projected('mkt');
eq([p['c-rep']._masterReadOnly,p['c-rep']._classificationReadOnly,p['c-rep'].opportunityGrade],[undefined,undefined,'A'],'a marketing officer: their branch\'s customer is open to them, with its classifications');
eq([p['c-jeddah']._masterReadOnly,p['c-jeddah']._classificationReadOnly,p['c-jeddah']._classificationHidden],[undefined,true,true],'another branch\'s: open to a request, its classifications hidden (the review of 2026-11-18)');
eq(Object.keys(classified).filter(key=>key in p['c-jeddah']),[],'none of the four reaches a marketing officer for another branch\'s customer');
eq([p['c-rep']._classificationHidden,p['own']._classificationHidden],[undefined,undefined],'their branch\'s carry no marker');
p=projected('rep');
eq([p['c-rep'].opportunityGrade,p['c-rep']._classificationReadOnly,p['c-rep']._classificationHidden,p['own'].opportunityGrade,p['own'].gradeNotes,p['own']._classificationHidden],['A',true,undefined,undefined,undefined,true],'a representative reads the classifications of their own customers only, read only; another\'s is marked hidden');
eq(Object.keys(classified).every(key=>!(key in p['c-jeddah']))&&p['c-jeddah']._classificationHidden,true,'nothing of another\'s customer\'s classifications reaches a representative');
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
ok(permissions.permissionRow('customer').cells.edit.roleNote.marketing.ar.includes('وتعديل عميل فرع آخر طلبٌ ينتظر الموافقة')&&permissions.permissionRow('customer').cells.edit.roleNote.marketing.ar.includes('ويغيّر منطقة عملاء فرعه مباشرةً'),'and what waits for approval (another branch\'s customer), the region of their own being direct since 2026-11-28');
ok(!ARABIC.test(permissions.permissionRow('customer').cells.edit.roleNote.marketing.en),'and in English');
eq(permissions.viewAllAvailable('marketing'),false,'no «عرض بيانات الفريق بالكامل»');
eq(permissions.copyPermissions({role:'rep',stored:permissions.normalizePermissions('rep',{cells:{'customer:delete':true}})},'marketing').skipped,['customer:delete'],'copying a representative\'s «حذف عميل» to a marketing officer is skipped and named');

// Corrections: direct, never a request; the classifications are request fields only for whom may send one (the supervisor).
eq(['marketing','rep','supervisor','customer_service','manager','admin'].map(editRules.proposesCustomerEdit),[false,true,true,true,false,false],'a marketing officer never sends a request');
eq(editRules.directCustomerEditRole('marketing'),false,'and decides none');
for(const field of classification.CLASSIFICATION_FIELDS)ok(editRules.CUSTOMER_EDIT_FIELDS.includes(field),field+' can travel in a supervisor\'s request');
eq(editRules.customerEditProposal({name:'x',customerInterest:'price'},{name:'x',customerInterest:'trust'}).fields,['customerInterest'],'a change of the interest is a request field');
eq(editRules.CUSTOMER_EDIT_CODE_FIELDS.has('factorySize'),true,'shown with its words in the list of requests');
eq(editRules.activeSupervisorOf('mkt',members)?.id,'sup','a marketing officer\'s request (another branch\'s customer) waits for their supervisor first, as a representative\'s');
eq(editRules.firstStage('mkt',members),'supervisor','its first stage');
eq(editRules.activeSupervisorOf('mkt',members.map(member=>member.id==='sup'?{...member,active:0}:member)),undefined,'with no active supervisor it goes to the sales manager');
eq(editRules.CUSTOMER_EDIT_HISTORY[editRules.DIRECT_EDIT],'تعديل مسؤول التسويق لبيانات العميل','the history\'s words for a marketing officer\'s direct correction');
ok(en[editRules.CUSTOMER_EDIT_HISTORY[editRules.DIRECT_EDIT]]&&!ARABIC.test(en[editRules.CUSTOMER_EDIT_HISTORY[editRules.DIRECT_EDIT]]),'and in English');

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
eq(classification.CLASSIFICATION_REFUSED,'اهتمام العميل يحدده مسؤول التسويق لعملاء فرعه، والمشرف لعملاء فريقه، ومدير المبيعات، ومدير النظام.','the refusal names who sets the interest (the one classification entered by hand), and claims no reading the refused member may not have');
for(const text of [classification.CLASSIFICATION_REFUSED,classification.INTEREST_REFUSED])ok(en[text]&&!ARABIC.test(en[text]),'English for: '+text);
const server=fs.readFileSync(path.join(root,'lib/crm-server.ts'),'utf8');
for(const name of ['MARKETING_NO_CUSTOMER_DELETE','MARKETING_OTHER_BRANCH']){const text=server.match(new RegExp('export const '+name+"='([^']+)'"))[1];ok(en[text]&&!ARABIC.test(en[text]),'English for: '+text);}

// The guard: every literal 'rep' left in lib/ and app/ names a representative alone for a reason listed here, or sits on a line that names
// the marketing officer too. A new check written for 'rep' fails here until it is decided for the marketing officer.
const KEEP=[
 ['lib/roles.ts','',"the field roles' own definition"],
 ['lib/crm-server.ts',"c.me.role==='rep'&&record.kind==='customer'","after the marketing officer's own guard (marketingCustomerGuard, and the refused deletion) above it"],
 ['lib/customer-edit-requests.ts',"['rep','supervisor','customer_service','customer_service_manager']",'who always sends a request: a marketing officer\'s waits only by marketingCorrectionWaits'],
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
eq(sqlRep,[],'no SQL names the representative alone (the request\'s supervisor step reads every field member: FIELD_ROLES_SQL)');

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
customer('c-rep','rep');customer('c-rep2','rep2');customer('c-old','rep2',{opportunityGrade:'B',gradeNotes:'ملاحظة من الإصدار السابق',factorySize:'A',customerInterest:'price'});customer('c-sup','sup');customer('c-mkt','mkt');customer('c-jeddah','mktJ',{},'الشرقية','جدة');customer('c-west','mktW',{},'الغربية');
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
eq(audits('c-rep2','تعديل').length,0,'not as a plain «تعديل»');
let direct=audits('c-rep2',editRules.DIRECT_EDIT);
eq(direct.map(a=>a.actor),['اسم mkt'],'the customer\'s history records who changed it (and when: created_at)');
let held=JSON.parse(direct[0].detail);
eq([held.v,held.by,held.customerName,[...held.fields].sort()],[1,'mkt','مصنع c-rep2',['city','notes','phone']],'and what: the changed fields (the review of 2026-11-18)');
eq([held.base.phone,held.values.phone,held.base.city,held.values.city,held.base.notes,held.values.notes],['0500000000','0512345678','الدمام','الخبر','','تحديث التسويق'],'each with what it held and what it holds');
eq([row('c-rep2').assigned_to,row('c-rep2').branch,row('c-rep2').data.code],['rep2','الرئيسي','ERP-c-rep2'],'the routing and the ERP code stay');
await post('mkt',edit('c-sup',{city:'القطيف'}));eq(row('c-sup').data.city,'القطيف','a supervisor\'s customer of the branch too');
await post('mkt',edit('c-mkt',{city:'الجبيل'}));eq(row('c-mkt').data.city,'الجبيل','their own customer');
// The limits: another branch, another region, the routing, a deletion, a stale version, another site.
// Another branch's customer of their regions (the review of 2026-11-18: it was refused): a request, as a representative's.
before=JSON.stringify(raw('c-jeddah'));
const other=await post('mkt',edit('c-jeddah',{city:'جدة'}));
eq([other.pendingApproval,other.approvalStage],[true,'supervisor'],'another branch\'s customer: a request, to their supervisor first');
eq(JSON.stringify(raw('c-jeddah')),before,'the customer unchanged while it waits');
eq(waiting('c-jeddah').map(w=>[w.requestedBy,w.stage,w.fields]),[['mkt','supervisor',['city']]],'the request holds the city only');
await post('mgr',{action:'customer-edit',decision:'approve',id:other.requestId},403);
eq((await post('sup',{action:'customer-edit',decision:'approve',id:other.requestId})).stage,'sales_manager','their supervisor passes it on');
eq((await post('mgr',{action:'customer-edit',decision:'approve',id:other.requestId})).status,'approved','the sales manager approves');
eq(row('c-jeddah').data.city,'جدة','applied');
eq(audits('c-jeddah',editRules.DIRECT_EDIT).length,0,'no direct correction is recorded for it');
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

// The classifications, as the owner corrected them (2026-11-18): «اهتمام العميل» entered by hand; the customer-level grade, its notes and a
// size stored by the release before are retired and carried exactly as stored by every save (the size is computed, the grade is each
// visit's «قوة الفرصة»).
const RETIRED=['opportunityGrade','gradeNotes','factorySize'],OLD=['B','ملاحظة من الإصدار السابق','A'];
const retired=id=>RETIRED.map(field=>row(id).data[field]);
await post('mkt',edit('c-rep2',{customerInterest:'technical'}));
eq([row('c-rep2').data.customerInterest,waiting('c-rep2').length],['technical',0],'a marketing officer sets the interest directly, with no request');
direct=audits('c-rep2',editRules.DIRECT_EDIT);held=JSON.parse(direct.at(-1).detail);
eq([held.fields,held.base.customerInterest,held.values.customerInterest],[['customerInterest'],'','technical'],'recorded with its before and after');
await post('mkt',edit('c-rep2',{factorySize:'D',opportunityGrade:'A',gradeNotes:'تصنيف جديد'}));
eq(RETIRED.filter(field=>field in row('c-rep2').data),[],'no size, grade or notes by hand: what a save sends for them is not stored (none was)');
eq(JSON.parse(audits('c-rep2',editRules.DIRECT_EDIT).at(-1).detail).fields,[],'and the history shows no change of them');
// What the release before stored survives every save untouched.
eq(retired('c-old'),OLD,'(stored by the release before)');
await post('mkt',edit('c-old',{phone:'0512121212',factorySize:'C',opportunityGrade:'D',gradeNotes:''}));
eq([row('c-old').data.phone,...retired('c-old')],['0512121212',...OLD],'a marketing officer\'s save: the old grade, notes and size untouched, whatever it sends');
await post('mkt',{...edit('c-old'),data:without(edit('c-old').data,RETIRED)});
eq(retired('c-old'),OLD,'a save that sends none of them keeps them');
await post('mgr',edit('c-old',{city:'الخبر',factorySize:null,opportunityGrade:null,gradeNotes:null}));
eq([row('c-old').data.city,...retired('c-old')],['الخبر',...OLD],'the sales manager\'s, sending null for them: untouched');
await post('owner',edit('c-old',{factorySize:'كبير',opportunityGrade:5,gradeNotes:'س'.repeat(3000)}));
eq(retired('c-old'),OLD,'values that are no longer checked are neither refused nor stored');
let sent=await post('rep',edit('c-old',{phone:'0599999990',opportunityGrade:'A',factorySize:'B'}));
eq([sent.pendingApproval,waiting('c-old')[0].fields],[true,['phone']],'a representative\'s request carries the phone only (not refused for them either)');
await post('sup',{action:'customer-edit',decision:'approve',id:sent.requestId});await post('mgr',{action:'customer-edit',decision:'approve',id:sent.requestId});
eq([row('c-old').data.phone,...retired('c-old')],['0599999990',...OLD],'approved: the phone, and the old values untouched');
// A request sent by the release before that carries a retired field: approving it now applies its other fields only.
const legacyKey=crypto.randomUUID(),legacyId='customer-edit:sup:'+legacyKey,current=row('c-old');
const legacy={v:1,requestedBy:'sup',key:legacyKey,customerId:'c-old',customerName:current.data.name,stage:'sales_manager',fields:['opportunityGrade','phone'],values:{opportunityGrade:'C',phone:'0533333333'},base:{opportunityGrade:'B',phone:current.data.phone},baseVersion:current.version,fingerprint:'legacy'};
sql.prepare("INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES(?,?,?,?,?,?)").run(legacyId,'c-old','اسم sup','customer-edit:request',JSON.stringify(legacy),now);
eq((await post('mgr',{action:'customer-edit',decision:'approve',id:legacyId})).status,'approved','a waiting request of the release before is approved');
eq([row('c-old').data.phone,...retired('c-old')],['0533333333',...OLD],'its phone applies; its grade does not (retired), and nothing else moves');
// The interest: who may set it, its values, null and absence.
eq((await post('rep',edit('c-rep',{customerInterest:'price'}),403)).error,classification.CLASSIFICATION_REFUSED,'a representative cannot set the interest');
await post('rep',edit('c-rep2',{customerInterest:'price'}),403);
await post('cs',edit('c-rep',{customerInterest:'price'}),403);
eq(waiting('c-rep').length+waiting('c-rep2').length,0,'and nothing waits');
eq((await post('mkt',edit('c-rep2',{customerInterest:'cheap'}),400)).error,classification.INTEREST_REFUSED,'an unknown interest is refused');
await post('mkt',edit('c-rep2',{customerInterest:null}));eq('customerInterest' in row('c-rep2').data,false,'null: emptied');
await post('mkt',edit('c-rep2',{customerInterest:' technical '}));eq(row('c-rep2').data.customerInterest,'technical','trimmed before it is checked');
await post('mkt',{...edit('c-rep2'),data:without(edit('c-rep2').data,['customerInterest'])});eq(row('c-rep2').data.customerInterest,'technical','a save without it keeps it');
sent=await post('rep',edit('c-rep2',{phone:'0599999999'}));
eq([sent.pendingApproval,waiting('c-rep2')[0].fields],[true,['phone']],'a representative\'s correction carrying the stored interest asks for the phone only');
await post('rep',{action:'customer-edit',decision:'cancel',id:sent.requestId});
sent=await post('rep',{...edit('c-rep2',{phone:'0588888888'}),data:without(edit('c-rep2',{phone:'0588888888'}).data,classification.CLASSIFICATION_FIELDS)});
eq(waiting('c-rep2')[0].fields,['phone'],'nor when it carries none (what a representative reads of another\'s customer)');
await post('rep',{action:'customer-edit',decision:'cancel',id:sent.requestId});
sent=await post('sup',edit('c-rep',{customerInterest:'service'}));
eq([sent.pendingApproval,sent.approvalStage,row('c-rep').data.customerInterest],[true,'sales_manager',undefined],'a supervisor\'s interest waits for the sales manager');
eq(waiting('c-rep')[0].fields,['customerInterest'],'the request carries it');
eq((await post('mgr',{action:'customer-edit',decision:'approve',id:sent.requestId})).status,'approved','the sales manager approves');
eq(row('c-rep').data.customerInterest,'service','applied');
await post('sup',edit('c-rep2',{customerInterest:'trust'}),403);
eq(row('c-rep2').data.customerInterest,'technical','another team\'s customer: refused');
await post('mgr',edit('c-jeddah',{customerInterest:'price'}));eq(row('c-jeddah').data.customerInterest,'price','the sales manager, directly');
await post('owner',edit('c-west',{customerInterest:'trust'}));eq(row('c-west').data.customerInterest,'trust','the administrator, directly');
eq([waiting('c-jeddah').length,waiting('c-west').length],[0,0],'neither waits');
await post('mkt',edit('c-jeddah',{customerInterest:'service'}),403);eq(row('c-jeddah').data.customerInterest,'price','a marketing officer never sets another branch\'s customer\'s interest');

// What each reads (GET /api/crm).
let data=await read('rep');
const repSees=id=>data.records.find(record=>record.id===id)?.data;
eq([repSees('c-rep').customerInterest,repSees('c-rep')._classificationReadOnly,repSees('c-rep')._classificationHidden],['service',true,undefined],'a representative reads their own customer\'s interest, read only');
eq([classification.CLASSIFICATION_FIELDS.some(field=>field in repSees('c-rep2')),repSees('c-rep2')._classificationHidden,classification.CLASSIFICATION_FIELDS.some(field=>field in repSees('c-old'))],[false,true,false],'and nothing of another\'s (the retired values neither), which is marked hidden');
data=await read('mkt');
eq([repSees('c-rep2').customerInterest,repSees('c-rep2')._classificationReadOnly,repSees('c-rep2')._classificationHidden,repSees('c-jeddah')._classificationReadOnly,repSees('c-jeddah')._masterReadOnly,repSees('c-jeddah')._classificationHidden],['technical',undefined,undefined,true,undefined,true],'a marketing officer: their branch open; another branch open to a request, its classifications hidden');
eq(classification.CLASSIFICATION_FIELDS.filter(field=>field in repSees('c-jeddah')),[],'none of another branch\'s reach them (stored: price)');
eq(retired('c-old'),RETIRED.map(field=>repSees('c-old')[field]),'the retired values travel with their branch\'s customer, unchanged (the page shows none)');
eq(data.me.role,'marketing','the page knows the role');
eq(data.audits.every(audit=>!['c-rep2','c-sup','c-mkt','c-jeddah','c-old'].includes(audit.recordId)),true,'the recent changes of a field member list their visits only, as a representative\'s');
data=await read('mgr');
const directSeen=data.audits.filter(audit=>audit.recordId==='c-rep2'&&audit.actor==='اسم mkt');
ok(directSeen.length>=1&&directSeen.every(audit=>audit.action===editRules.CUSTOMER_EDIT_HISTORY[editRules.DIRECT_EDIT]&&audit.detail==='مصنع c-rep2'&&Array.isArray(audit.changes)),'the sales manager reads the marketing officer\'s corrections in the history, by name, with their changes');
eq(directSeen.flatMap(audit=>audit.changes).find(change=>change.field==='phone'),{field:'phone',before:'0500000000',after:'0512345678'},'the first one\'s phone, before and after');
// A save built from what the page read (the marker with it) keeps the hidden classifications and stores no marker.
const pageRow=(await read('mkt')).records.find(record=>record.id==='c-jeddah');
const fromPage=await post('mkt',{action:'save',kind:'customer',id:'c-jeddah',version:pageRow.version,editKey:crypto.randomUUID(),data:{...pageRow.data,assignedTo:pageRow.assignedTo,branch:pageRow.branch,phone:'0577777777'}});
eq(waiting('c-jeddah').find(request=>request.id===fromPage.requestId).fields,['phone'],'the request from the page asks for the phone only');
await post('sup',{action:'customer-edit',decision:'approve',id:fromPage.requestId});await post('mgr',{action:'customer-edit',decision:'approve',id:fromPage.requestId});
eq([row('c-jeddah').data.phone,row('c-jeddah').data.customerInterest,Object.keys(row('c-jeddah').data).filter(key=>key.startsWith('_classification'))],['0577777777','price',[]],'approved: the phone changed, the interest kept, no marker stored');
// A change of their branch's customer's region is saved directly since 2026-11-28 (the owner: «عايز ادى صلاحية تغيير المنطقة للمسوق»; from
// 2026-11-18 it waited), bounded by the server: one of the officer's regions, covered by the customer's representative, recorded with
// what it changed. A representative's change of region still waits.
const regionsLib=await lib('regions');
sql.prepare("UPDATE crm_members SET region_scope=? WHERE id IN ('mkt','rep')").run(regionsLib.canonicalRegionScope(['eastern','central']));
const moved=await post('mkt',edit('c-rep',{region:'الوسطى',city:'الرياض'}));
eq([moved.pendingApproval,row('c-rep').data.region,row('c-rep').data.city,row('c-rep').assigned_to,waiting('c-rep').length],[undefined,'الوسطى','الرياض','rep',0],'a new region of their branch\'s customer: saved directly, the representative kept, no request');
const movedHistory=audits('c-rep',editRules.DIRECT_EDIT).map(entry=>JSON.parse(entry.detail)).at(-1);
eq([...movedHistory.fields].sort(),['city','region'],'recorded in the customer\'s history with what it changed');
eq([movedHistory.values.region,movedHistory.base.region],['الوسطى','الشرقية'],'the region before and after');
let refusal=await post('mkt',edit('c-rep',{region:'الغربية'}),403);
eq([refusal.error,row('c-rep').data.region],['لا يمكنك إنشاء أو نقل عميل خارج منطقتك المسموح بها','الوسطى'],'a region outside the officer\'s own: refused, nothing written');
sql.prepare("UPDATE crm_members SET region_scope='central' WHERE id='rep'").run();
refusal=await post('mkt',edit('c-rep',{region:'الشرقية'}),400);
eq([refusal.error,row('c-rep').data.region],['منطقة العميل لا تطابق صلاحية المندوب المسؤول','الوسطى'],'a region the customer\'s representative does not cover: refused (the officer cannot reassign)');
sql.prepare("UPDATE crm_members SET region_scope=? WHERE id='rep'").run(regionsLib.canonicalRegionScope(['eastern','central']));
const repMove=await post('rep',edit('c-rep',{region:'الشرقية'}));
eq([repMove.pendingApproval,row('c-rep').data.region],[true,'الوسطى'],'a representative\'s change of region still waits for approval');
await post('rep',{action:'customer-edit',decision:'cancel',id:repMove.requestId});
const routing=await post('mkt',edit('c-rep',{region:'الشرقية',assignedTo:'mkt',branch:'جدة'}),403);
eq([routing.error,row('c-rep').data.region,row('c-rep').assigned_to,row('c-rep').branch],['لا يمكنك تغيير مسؤول العميل أو فرعه','الوسطى','rep','الرئيسي'],'a new region sent with another representative or branch: refused whole, nothing written');
eq([(await post('mkt',edit('c-rep',{region:'الشرقية'}))).pendingApproval,row('c-rep').data.region],[undefined,'الشرقية'],'the region back alone: saved directly');
await post('mkt',edit('c-rep',{city:'الدمام'}));eq([row('c-rep').data.city,row('c-rep').data.region],['الدمام','الشرقية'],'the same region: direct, as before');
sql.prepare("UPDATE crm_members SET region_scope='eastern' WHERE id IN ('mkt','rep')").run();

// A new customer: a marketing officer's own, with its interest; saved on the device first (the offline queue replays the same body). A
// body of the release before (with a grade, notes and a size) is saved without them.
const createKey=crypto.randomUUID(),capturedAt=new Date(Date.now()-60_000).toISOString().replace(/\.\d+Z$/,'.000Z');
const newBody={action:'save',kind:'customer',createKey,offline:{memberId:'mkt',capturedAt},data:{name:'مصنع التسويق الجديد',region:'الشرقية',city:'الدمام',phone:'0501231234',customerKind:'مصنع',opportunityGrade:'B',factorySize:'D',customerInterest:'trust',gradeNotes:'قيد الدراسة',branch:'آخر',assignedTo:'rep'}};
saved=await post('mkt',newBody);
const fresh=row(saved.id);
eq([fresh.assigned_to,fresh.branch,fresh.data.customerInterest,fresh.data.offlineRecordedAt,RETIRED.filter(field=>field in fresh.data)],['mkt','الرئيسي','trust',capturedAt,[]],'saved on the device: the marketing officer\'s own, with its interest and the device\'s time; no retired value on a new customer');
eq((await post('mkt',newBody)).alreadySaved,true,'the queue\'s replay is one customer');
eq((await post('rep',{action:'save',kind:'customer',createKey:crypto.randomUUID(),data:{name:'مصنع مندوب جديد',region:'الشرقية',city:'الدمام',phone:'0501231299',customerInterest:'price'}},403)).error,classification.CLASSIFICATION_REFUSED,'a representative\'s new customer cannot carry an interest');
saved=await post('rep',{action:'save',kind:'customer',createKey:crypto.randomUUID(),data:{name:'مصنع مندوب جديد',region:'الشرقية',city:'الدمام',phone:'0501231299',opportunityGrade:'A',factorySize:'B',customerInterest:''}});
eq(classification.CLASSIFICATION_FIELDS.filter(field=>field in row(saved.id).data),[],'a grade or a size of an old page is no refusal and is not stored; an empty interest is none');

// The team screen: a member of the new role, under a supervisor.
const memberBody={name:'مسؤول تسويق تجريبي',email:'new.marketing@yourrest.org',role:'marketing',branch:'الرئيسي',supervisorId:'sup',regionScope:['eastern'],active:1,target:0};
await post('mgr',{action:'member',data:memberBody},403);
await post('owner',{action:'member',data:memberBody});
const created=sql.prepare("SELECT role,supervisor_id AS sup,region_scope AS region FROM crm_members WHERE email='new.marketing@yourrest.org'").get();
eq({...created},{role:'marketing',sup:'sup',region:'eastern'},'the administrator adds a marketing officer under a supervisor');
await post('owner',{action:'member',data:{...memberBody,email:'bad.marketing@yourrest.org',supervisorId:'cs'}},400);
await post('owner',{action:'member',data:{...memberBody,email:'odd@yourrest.org',role:'marketer'}},400);

console.log(JSON.stringify({ok:true,checks,realSqlite:true,productionDataUsed:false}));
