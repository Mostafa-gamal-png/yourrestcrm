// A new opportunity needs its result and its next step (the owner, 2026-11-15, from GSCO: «هل يمكن تسجيل فرصة بدون نتيجة» then «خليها إجبارية
// والاجراء القادم»; lib/opportunity-entry.ts). In Yourrest an opportunity is registered as a new visit or contact on a customer (POST
// /api/visits, which the screens call adding an opportunity, and customer service's «فرصة جديدة», POST /api/customer-service). 1. The pure
// rule: «نتيجة الزيارة» or «نتيجة التواصل», at least 3 letters once trimmed (a follow-up's rule), the next action and its date, the hard
// inputs. 2. The routes on an isolated in-memory SQLite with the clock fixed: refused with the field's message and nothing written, online
// and queued on the device; the same queued entry completed by the member is saved once; an edit asks nothing new; a follow-up keeps its
// own rule. 3. Which server paths create visits or opportunities at all (the imports create none). Synthetic people only; no network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'opportunity-entry-')),seen=new Set();
process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const u=globalThis.testUser;if(!u)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version FROM crm_members WHERE user_id=? OR email=?').bind(u.userId,u.email).first();return {...u,provider:'email-otp',memberId:m?.id||'missing',memberVersion:m?.auth_version};}`);
function compile(relative){if(seen.has(relative))return;seen.add(relative);const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';compile(source);return 'from '+JSON.stringify(path.join(out,source.replace(/\.tsx?$/,'.mjs')));});fs.writeFileSync(dest,code);}
for(const name of ['visits','customer-followups','customer-service'])compile('app/api/'+name+'/route.ts');
compile('lib/opportunity-entry.ts');
const rules=await import(pathToFileURL(path.join(out,'lib/opportunity-entry.mjs')));
const M=rules.OPPORTUNITY_MESSAGES;

// ---- 1. The rule.
eq(M,{visitResult:'اكتب نتيجة الزيارة قبل حفظ الفرصة (3 أحرف على الأقل).',contactResult:'اكتب نتيجة التواصل قبل حفظ الفرصة (3 أحرف على الأقل).',nextAction:'اكتب الإجراء القادم قبل حفظ الفرصة.',nextDate:'حدد موعد المتابعة قبل حفظ الفرصة.'},'the four messages, word for word');
eq(rules.OPPORTUNITY_RESULT_MIN,3,'3 letters, as a follow-up\'s result');
const complete={type:'visit',result:'تمت',nextAction:'اتصال',nextDate:'2026-11-16'};
eq(rules.opportunityProblems(complete,'rep'),{},'a complete entry');
eq(rules.opportunityProblem(complete,'rep'),'','nothing to say');
eq(rules.opportunityProblems({},'rep'),{result:M.contactResult,nextAction:M.nextAction,nextDate:M.nextDate},'nothing filled: the three, each with its words');
for(const [type,role,message] of [['visit','rep',M.visitResult],['visit','supervisor',M.visitResult],['visit','admin',M.visitResult],['call','rep',M.contactResult],['whatsapp','manager',M.contactResult],['email','rep',M.contactResult],['website','customer_service',M.contactResult],['visit','customer_service',M.contactResult],['visit','customer_service_manager',M.contactResult],['visit',undefined,M.visitResult]])
 eq(rules.opportunityProblems({...complete,type,result:''},role).result,message,type+' by '+role+': '+message);
for(const result of ['','  ','ab','  اب  ','\n\t',null,undefined,5,['تمت']])eq(rules.opportunityProblems({...complete,result},'rep').result,M.visitResult,'refused result: '+JSON.stringify(result));
for(const result of ['تمت',' تمت ','تم الشراء','٣٣٣','abc','سلبية','x'.repeat(250)])eq(rules.opportunityProblems({...complete,result},'rep').result,undefined,'accepted result: '+JSON.stringify(result).slice(0,30));
eq(rules.opportunityProblems({...complete,result:'\u200f\u200fاب'},'rep').result,undefined,'marks of direction count as a follow-up\'s rule counts them (trim leaves them)');
eq([rules.opportunityProblems({...complete,result:'',outcome:'effective'},'rep').result,rules.opportunityProblems({...complete,result:'',outcome:'followup'},'rep').result,rules.opportunityProblems({...complete,result:'',outcome:'pending'},'rep').result,rules.opportunityProblems({...complete,result:'',outcome:'x'},'rep').result],[undefined,undefined,M.visitResult,M.visitResult],'a page of before that sent the outcome («فعالة», «متابعة العميل») has its result, as the visit shows it; «غير مصنفة» is none');
for(const nextAction of ['','   ',null])eq(rules.opportunityProblem({...complete,nextAction},'rep'),M.nextAction,'no next action: '+JSON.stringify(nextAction));
for(const nextDate of ['',' ',undefined])eq(rules.opportunityProblem({...complete,nextDate},'rep'),M.nextDate,'no follow-up date: '+JSON.stringify(nextDate));
eq(rules.opportunityProblem({type:'visit',result:'',nextAction:'',nextDate:''},'rep'),M.visitResult,'the first problem is the result, in the form\'s order');
eq(rules.opportunityProblem({type:'visit',result:'تمت',nextAction:'',nextDate:''},'rep'),M.nextAction,'then the next action');
for(const message of Object.values(M))ok(rules.isOpportunityMessage(message)&&rules.isOpportunityMessage(' '+message+' '),'one of ours: '+message);
for(const message of ['الإجراء القادم وموعد المتابعة مطلوبان','',null,'x'])ok(!rules.isOpportunityMessage(message),'not ours: '+message);
const english=JSON.parse(fs.readFileSync('lib/locales/en.json','utf8'));
for(const message of Object.values(M))ok(typeof english[message]==='string'&&!/[؀-ۿ]/.test(english[message]),'English pair: '+english[message]);

// ---- 2. The routes, with the clock fixed (Riyadh 12:00 on 2026-11-15).
const migrations=fs.readdirSync(path.join(root,'drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).sort();
eq(migrations.length,21,'no new migration');
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const name of migrations)sql.exec(fs.readFileSync(path.join(root,'drizzle',name),'utf8'));
class Statement{constructor(q,a=[]){this.q=q;this.a=a;}bind(...a){return new Statement(this.q,a);}async run(){const r=sql.prepare(this.q).run(...this.a);return{meta:{changes:Number(r.changes)}};}async all(){return{results:sql.prepare(this.q).all(...this.a)};}async first(){return sql.prepare(this.q).get(...this.a)||null;}}
const DB={prepare:q=>new Statement(q),batch:async statements=>{sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid'};
const NativeDate=Date;let clock=NativeDate.parse('2026-11-15T09:00:00.000Z');
globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
process.on('exit',()=>{globalThis.Date=NativeDate;});
const day='2026-11-15',iso=()=>new Date().toISOString(),captured='2026-11-15T07:30:00.000Z';
const member=(id,role,supervisor=null,region='eastern')=>sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,1,0,?)').run(id,'u-'+id,id+'@yourrest.org','اسم '+id,role,'الرئيسي',supervisor,region,iso());
member('owner','admin',null,'all');member('sup','supervisor');member('rep','rep','sup');member('cs','customer_service');
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-owner')").run();
const insert=(id,kind,parentId,data,author='rep')=>sql.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,?,?,?,?,1,?)').run(id,kind,parentId,author,'الرئيسي',JSON.stringify(kind==='customer'?{name:id,region:'الشرقية',location:'26.437341, 50.034499',latitude:26.437341,longitude:50.034499,...data}:{performedBy:author,recordedByEmail:author+'@yourrest.org',...data}),iso(),iso(),'fixture');
const raw=id=>sql.prepare('SELECT * FROM crm_records WHERE id=?').get(id);
const activities=()=>sql.prepare("SELECT COUNT(*) AS n FROM crm_records WHERE kind='activity'").get().n;
const user=id=>{globalThis.testUser=id?{userId:'u-'+id,email:id+'@yourrest.org',fullName:id}:null;};
const routes={};for(const name of ['visits','customer-followups','customer-service'])routes[name]=await import(pathToFileURL(path.join(out,'app/api/'+name+'/route.mjs')));
async function post(name,payload,status=200){const response=await routes[name].POST(new Request('https://test.invalid/api/'+name,{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json'},body:JSON.stringify(payload)}));const result=await response.json();eq(response.status,status,name+' '+JSON.stringify(result).slice(0,300));return result;}
const fields={type:'call',summary:'تعريف بمنتجات الشركة',result:'متابعة العميل',salesStage:'new',strength:'strong',requestedProducts:['قوالب البلوك المتحركة'],nextAction:'متابعة المواصفات',nextDate:day,location:'26.437341, 50.034499',locationSource:'device',locationCapturedAt:captured,locationAccuracy:12};
const visit=(customerId,data={},extra={})=>({createKey:crypto.randomUUID(),customerId,customerVersion:raw(customerId).version,timingMode:'automatic',elapsedMilliseconds:120000,data:{...fields,...data},...extra});
insert('f1','customer',null,{});insert('f2','customer',null,{});insert('f3','customer',null,{});

// 2.1 A new visit or contact online: each missing field refused with its own words, nothing written.
user('rep');
for(const [data,message] of [[{result:''},M.contactResult],[{result:'ab'},M.contactResult],[{result:'   '},M.contactResult],[{type:'visit',result:''},M.visitResult],[{type:'whatsapp',result:'ok'},M.contactResult],[{nextAction:''},M.nextAction],[{nextAction:'   '},M.nextAction],[{nextDate:''},M.nextDate],[{result:'',nextAction:'',nextDate:''},M.contactResult]]){
 const body=visit('f1',data);delete body.data.journeyStopId;
 eq((await post('visits',body,400)).error,message,'new visit '+JSON.stringify(data)+': '+message);
}
{const body=visit('f1');delete body.data.result;eq((await post('visits',body,400)).error,M.contactResult,'no result field at all');}
eq(activities(),0,'nothing written');
const saved=await post('visits',visit('f1',{result:'تم أخذ موعد'}));eq(JSON.parse(raw(saved.id).data).result,'تم أخذ موعد','a complete new visit is saved');
const visitAt=await post('visits',visit('f2',{type:'visit',result:'تم الشراء'}));eq(JSON.parse(raw(visitAt.id).data).type,'visit','a physical visit too');
// 2.2 Editing a saved visit asks nothing new (the result may stay as it was: here none at all, as a visit of before).
insert('old-visit','activity','f3',{...fields,type:'visit',result:'',date:day,visitWorkflow:'customer-v1',responsibleId:'rep'});
user('owner');
const edited=await post('visits',{createKey:crypto.randomUUID(),id:'old-visit',version:1,customerId:'f3',customerVersion:raw('f3').version,timingMode:'automatic',elapsedMilliseconds:0,data:{...fields,type:'visit',result:'',summary:'تعديل من الإدارة'}});
eq([edited.id,JSON.parse(raw('old-visit').data).summary,JSON.parse(raw('old-visit').data).result],['old-visit','تعديل من الإدارة',''],'an edit without a result: saved, the rule is the new opportunity\'s only');
user('rep');

// 2.3 Queued on the device without a network: the server refuses it the same way when it uploads (the outbox marks it «تحتاج مراجعة» with
// the message), and the member's completed entry (the same key, the same moment it was recorded on the device) is saved once.
const queued=visit('f2',{result:''},{offline:{memberId:'rep',capturedAt:captured}});
const before=activities();
eq((await post('visits',queued,400)).error,M.contactResult,'a queued entry without a result comes back with the message');
eq((await post('visits',queued,400)).error,M.contactResult,'a retry of the same entry: the same message (nothing half-saved)');
eq(activities(),before,'nothing written');
const completed={...queued,data:{...queued.data,result:'متابعة العميل'}};
const uploaded=await post('visits',completed);
eq([uploaded.id,JSON.parse(raw(uploaded.id).data).result,JSON.parse(raw(uploaded.id).data).offlineRecordedAt],['customer-visit-'+queued.createKey,'متابعة العميل',captured],'the completed entry is saved under its own key, with the moment it was recorded on the device');
eq((await post('visits',completed)).alreadySaved,true,'its replay is the same visit');
eq(activities(),before+1,'one visit, never two');
const queuedNext={...visit('f3',{nextDate:''}),offline:{memberId:'rep',capturedAt:captured}};
eq((await post('visits',queuedNext,400)).error,M.nextDate,'a queued entry without its follow-up date: refused with that field\'s words');

// 2.4 Customer service's «فرصة جديدة» (and a further contact on an open request): the same rule, in the contact's words.
user('cs');insert('s1','customer',null,{});
const service=(data={},extra={})=>({action:'create',requestId:crypto.randomUUID(),customerId:'s1',customerVersion:raw('s1').version,registration:{...fields,type:'visit',...data},elapsedMilliseconds:60000,...extra});
for(const [data,message] of [[{result:''},M.contactResult],[{result:'نعم'.slice(0,2)},M.contactResult],[{type:'call',result:''},M.contactResult],[{nextAction:''},M.nextAction],[{nextDate:''},M.nextDate]])eq((await post('customer-service',service(data),400)).error,message,'customer service '+JSON.stringify(data)+': '+message);
eq(sql.prepare('SELECT COUNT(*) AS n FROM crm_service_cases').get().n,0,'no request written');
const queuedService=service({result:''},{offline:{memberId:'cs',capturedAt:captured}});
eq((await post('customer-service',queuedService,400)).error,M.contactResult,'queued without a result: refused with the message');
const opened=await post('customer-service',{...queuedService,registration:{...queuedService.registration,result:'تم أخذ موعد'}});
ok(typeof opened.id==='string'&&sql.prepare('SELECT COUNT(*) AS n FROM crm_service_cases').get().n===1,'completed: the request is opened once');
eq((await post('customer-service',service({result:'ab'}),400)).error,M.contactResult,'a further contact on the open request asks the same');
const contact=await post('customer-service',service({result:'متابعة العميل'}));eq(contact.id,opened.id,'and is added to it once complete');
// Editing the registration keeps its earlier rule (a result, whatever its length).
const caseRow=sql.prepare('SELECT id,version FROM crm_service_cases').get();
await post('customer-service',{action:'edit',id:caseRow.id,version:caseRow.version,customerId:'s1',customerVersion:raw('s1').version,registration:{...fields,type:'visit',result:'اب'},requestId:crypto.randomUUID()});
eq(JSON.parse(sql.prepare('SELECT data FROM crm_service_cases').get().data).registration.result,'اب','an edit is not asked for 3 letters');
eq((await post('customer-service',{action:'edit',id:caseRow.id,version:caseRow.version+1,customerId:'s1',customerVersion:raw('s1').version,registration:{...fields,type:'visit',result:''},requestId:crypto.randomUUID()},400)).error,'سجّل نتيجة الزيارة قبل إنهائها','and an empty one keeps its earlier message');

// 2.5 Executing a follow-up keeps its own rule and words.
user('rep');
const followup={createKey:crypto.randomUUID(),customerId:'f1',customerVersion:raw('f1').version,sourceId:saved.id,sourceVersion:raw(saved.id).version,data:{type:'call',date:day,result:'اب',salesStage:'new',invoiceOutcome:'pending',nextAction:'المتابعة التالية',nextDate:day}};
ok(/اكتب نتيجة المتابعة في 3 أحرف على الأقل/.test((await post('customer-followups',followup,400)).error),'a follow-up: its own message');

// ---- 3. Which server paths create a visit or an opportunity: the two that ask the rule, the follow-up's execution (its own rule) and the
// two earlier generic routes no screen sends to. No import does (customers, machines, ERP customers, quotations, sales, collections, KPI
// evidence); a restoration from «المحذوفات» puts back what was deleted. A new path that writes visits must be added here, knowingly.
const sources=['app','lib'].flatMap(dir=>fs.readdirSync(dir,{recursive:true}).filter(name=>/\.tsx?$/.test(name)).map(name=>path.join(dir,name)));
const writers=sources.filter(file=>/INSERT[^;`]{0,60}INTO crm_records[^;`]{0,200}'(activity|opportunity)'/.test(fs.readFileSync(file,'utf8'))).sort();
eq(writers,['app/api/customer-followups/route.ts','app/api/followups/route.ts','app/api/visits/route.ts'],'the routes that insert visits or opportunities by name');
ok(/kind==='activity'/.test(fs.readFileSync('app/api/crm/route.ts','utf8'))&&/requireLegacyVisit\(body\.data/.test(fs.readFileSync('app/api/crm/route.ts','utf8')),'/api/crm writes only an earlier kind of visit (requireLegacyVisit refuses a new one\'s fields)');
for(const file of sources.filter(name=>/import|erp-|kpi-evidence|trash/.test(name)))ok(!/INSERT[^;`]{0,60}INTO crm_records[^;`]{0,200}'(activity|opportunity)'/.test(fs.readFileSync(file,'utf8')),'no visit or opportunity written by '+file);
ok(fs.readFileSync('app/api/visits/route.ts','utf8').includes('if(!old){const problem=opportunityProblem(data,c.me.role)'),'the visit route asks the rule of a new visit only');
ok(fs.readFileSync('app/api/customer-service/route.ts','utf8').includes("if(action!=='edit'){const problem=opportunityProblem(registration,c.me.role)"),'the customer-service route asks it of a new registration or contact only');

console.log(JSON.stringify({ok:true,checks,coverage:'the new opportunity\'s result, next action and date: the rule and its words, the visit and customer-service routes online and queued on the device, the completed entry saved once, edits and follow-ups unchanged, which paths create visits',realBrowser:false}));
