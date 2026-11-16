// Item 2 of the GSCO list (2026-11-16, approved by the owner: «تمام موافق ابدأ»; GSCO 2.13.76), without a build:
// «مدير المبيعات يخرج من «مقارنة أداء المندوبين» ومن التقييم ومن مستهدفات النشاط، حتى لو له كود موظف أو تقييمات قديمة. التقييمات القديمة تفضل
// محفوظة.» «جنب «بيانات ناقصة» تظهر أسماء المؤشرات الناقصة وأوزانها.» «فوق الجدول مربع «المطلوب لاكتمال التقييم».» «في صفحة الموظف قايمة بكل
// مؤشر ناقص، والمطلوب عشان يتحسب.» «طريقة حساب الدرجة ما تتغيرش.»
// 1. The real routes (GET /api/sales?kpis=1, POST /api/kpis, GET /api/kpi-evidence, POST /api/targets, compiled as the build does) on a migrated
//    in-memory SQLite: a sales manager with an ERP employee code, ERP sales of his own, a visit and an old assessment row is in nobody's
//    evaluation (the administrator's, his own, the supervisor's), cannot be assessed (404, as a member out of the evaluation) nor have
//    «بيانات المؤشرات» read (404) nor customer and visit targets saved (400); his old row stays as it was; a representative and a supervisor
//    are evaluated and saved as before.
// 2. The score did not change: every representative's and supervisor's metrics, summary and attainment, and the rest of the answer of
//    /api/sales, equal what the release before this change (commit f9fe2bf) gives for the same data. The digests below were made by running
//    this file with «--baseline f9fe2bf» (which compiles that commit's routes from git and compares live); without it they are compared with
//    the digests kept here. «--print-digest» prints the current ones.
// 3. What completes the evaluation (lib/kpi-gaps.ts): each missing indicator with its weight and its action (who and where), the five conduct
//    indicators as one line when all are missing, «لا ينطبق» never listed, a case not listed keeping its own reason, the summary's lines
//    (weight of the indicators completed, the people, the visits waiting), the reasons it matches still written so by the server.
// 4. The screens, rendered on the server with the real components and the real answer of the route: the box «المطلوب لاكتمال التقييم» above the
//    comparison, the missing indicators with their weights under «بيانات ناقصة» in the table, the checklist on the person's page, the cards,
//    the targets page without the manager's customer and visit targets, both exports; Arabic and English (no Arabic left but names).
// Synthetic data only: temporary in-memory SQLite, no production data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');fs.mkdirSync(runtime,{recursive:true});
const work=fs.mkdtempSync(path.join(runtime,'kpi-sales-manager-gaps-'));
process.on('exit',()=>fs.rmSync(work,{recursive:true,force:true}));
const argv=process.argv.slice(2),baselineRev=argv.includes('--baseline')?argv[argv.indexOf('--baseline')+1]:null,printDigest=argv.includes('--print-digest');
// node:sqlite gives rows of a null prototype and the VM's modules objects of another realm: both sides compared as plain JSON.
const json=value=>value===undefined?value:JSON.parse(JSON.stringify(value));
let checks=0;const eq=(actual,expected,message)=>{assert.deepEqual(json(actual),json(expected),message);checks++;},ok=(value,message)=>{assert.ok(value,message);checks++;};
const counts={};const counted=async(part,fn)=>{const before=checks;await fn();counts[part]=checks-before;};
const MONTH='2025-10',STAMP='2025-01-01T00:00:00.000Z';
const ARABIC=/[\u0600-\u06ff]/;

// ---- The modules as the page loads them (TypeScript compiled to CommonJS in a VM), for the pure rules and the screens.
const nativeRequire=createRequire(import.meta.url),cache=new Map();
const cjs={module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true};
function vmLoad(file,require){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:cjs}).outputText,{exports,require,console,Intl,crypto:globalThis.crypto,structuredClone,AbortController,URL,setTimeout,clearTimeout,Error,TypeError});return exports;}
function library(file){if(cache.has(file))return cache.get(file);const value=vmLoad(file,name=>name.startsWith('.')?library(path.join(path.dirname(file),name)+'.ts'):nativeRequire(name));cache.set(file,value);return value;}
const PRODUCTS=library('lib/targets.ts').targetProducts.map(product=>product.id);

// ---- The routes of a source tree, compiled as the build does, on their own in-memory SQLite.
function compiler(source,out){
 const seen=new Set();
 fs.mkdirSync(out,{recursive:true});
 // The environment is read at every access, so two trees in one process each see the database of their own run.
 fs.writeFileSync(path.join(out,'env.mjs'),'export const env=new Proxy({},{get:(_,key)=>globalThis.testEnv?.[key],has:(_,key)=>key in (globalThis.testEnv||{})});');
 fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const id=globalThis.testIdentity;if(!id)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version,email FROM crm_members WHERE id=?').bind(id).first();return {memberId:m?.id,memberVersion:m?.auth_version,email:m?.email,provider:'email-otp'};}`);
 fs.writeFileSync(path.join(out,'parser.mjs'),`export class ErpWorkbookError extends Error{};export function parseErpWorkbook(){throw Error('KPI reads cannot invoke the workbook parser');}`);
 function compile(relative){
  if(seen.has(relative))return;seen.add(relative);
  const src=path.join(source,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});
  let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
   if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));
   if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));
   if(imp==='./erp-sales')return 'from '+JSON.stringify(path.join(out,'parser.mjs'));
   if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
   let rel=imp.startsWith('@/')?imp.slice(2):path.relative(source,path.resolve(path.dirname(src),imp));
   if(!/\.tsx?$/.test(rel))rel+=fs.existsSync(path.join(source,rel+'.ts'))?'.ts':'.tsx';
   compile(rel);return 'from '+JSON.stringify(path.join(out,rel.replace(/\.tsx?$/,'.mjs')));
  });fs.writeFileSync(dest,code);
 }
 return {compile,load:file=>import(pathToFileURL(path.join(out,file)))};
}
const members=[['owner','admin',null,'all'],['mgr','manager',null,'all'],['sup','supervisor','mgr','eastern'],['rep1','rep','sup','eastern'],['rep2','rep','sup','eastern'],['rep3','rep','mgr','eastern'],['cs','customer_service','mgr','eastern']];
async function fixture(source,label){
 const {compile,load}=compiler(source,path.join(work,label));
 for(const file of ['app/api/sales/route.ts','app/api/kpis/route.ts','app/api/kpi-evidence/route.ts','app/api/targets/route.ts'])compile(file);
 const migrations=fs.readdirSync(path.join(root,'drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).sort();
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const name of migrations)sql.exec(fs.readFileSync(path.join(root,'drizzle',name),'utf8'));
 class Statement{constructor(q,a=[]){this.q=q;this.a=a;}bind(...a){return new Statement(this.q,a);}async run(){const r=sql.prepare(this.q).run(...this.a);return{meta:{changes:Number(r.changes)}};}async all(){return{results:sql.prepare(this.q).all(...this.a)};}async first(){return sql.prepare(this.q).get(...this.a)||null;}}
 const DB={prepare:q=>new Statement(q),batch:async statements=>{sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(/^\s*(SELECT|WITH)/i.test(s.q)?{...await s.all(),meta:{changes:0}}:await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const env={DB,YR_APP_ORIGIN:'https://test.invalid',YR_AUTH_SECRET:'a'.repeat(64)};globalThis.testEnv=env;
 for(const [id,role,supervisor,region] of members)sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,1,0,?)').run(id,'u-'+id,id+'@yourrest.org','اسم '+id,role,'الرئيسي',supervisor,region,STAMP);
 sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-owner')").run();
 const record=(id,kind,parent,assigned,data)=>sql.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').run(id,kind,parent,assigned,'الرئيسي',JSON.stringify(data),STAMP,STAMP);
 for(const id of ['rep1','rep2','rep3','sup','mgr'])record('c-'+id,'customer',null,id,{name:'مصنع '+id,region:'الشرقية',city:'الدمام',phone:'0500000000'});
 const visit=(by,date)=>record('v-'+by+'-'+date,'activity','c-'+by,by,{type:'visit',date,summary:'تعريف',result:'العميل مهتم',performedBy:by,responsibleId:by,recordedByEmail:by+'@yourrest.org',salesStage:'specs'});
 for(const [by,date] of [['rep1','2025-07-10'],['rep1','2025-08-10'],['rep1','2025-09-10'],['rep1','2025-10-10'],['rep1','2025-10-20'],['rep2','2025-09-12'],['rep2','2025-10-12'],['rep3','2025-10-14'],['sup','2025-10-16'],['mgr','2025-10-18']])visit(by,date);
 const target=(kind,scope,data)=>sql.prepare('INSERT INTO crm_target_sets(kind,scope_id,month,data,version,mutation_id,updated_by,updated_at) VALUES(?,?,?,?,1,?,?,?)').run(kind,scope,'2025-01',JSON.stringify(data),'fixture','owner',STAMP);
 const products=quantities=>({products:PRODUCTS.map((product,i)=>({product,quantity:i<2?quantities[i]:0}))});
 target('weights','company',{products:PRODUCTS.map((product,i)=>({product,weight:[60,40][i]||0}))});
 target('sales','rep1',products([10,5]));target('sales','rep2',products([8,null]));target('sales','rep3',products([4,2]));
 target('activity','rep1',{newCustomers:2,recoveredCustomers:1,visits:4});target('activity','sup',{newCustomers:1,recoveredCustomers:1,visits:2});target('activity','rep3',{newCustomers:1,recoveredCustomers:1,visits:2});
 // The complete ERP sales cover rep1 and rep2 (not rep3) up to the end of October.
 sql.prepare('INSERT INTO crm_erp_imports(id,actor_id,fingerprint,file_name,result,created_at) VALUES(?,?,?,?,?,?)').run('erp-import-1','owner','fp-1','synthetic.xlsx',JSON.stringify({coverage:{complete:true,from:'2025-01-01',to:'2025-10-31',months:[],partialMonths:[],repIds:['rep1','rep2'],allReps:false,importerId:'owner',importer:'مدير النظام',at:STAMP,importId:'erp-import-1'}}),STAMP);
 let n=0;const erp=(rep,code,date,product,quantity,employee='E-'+rep)=>{n++;sql.prepare("INSERT INTO crm_erp_sales(id,document_key,content_hash,mapped_hash,reference,document_type,date,employee_id,rep_id,branch,region_scope,customer_code,customer_name,data,total_cents,import_id,created_by,created_at) VALUES(?,?,'h','m',?,'sale',?,?,?,'الرئيسي','eastern',?,'عميل اصطناعي',?,10000,'erp-import-1','owner',?)").run('erp-'+n,'doc-'+n,'INV-'+n,date,employee,rep,code,JSON.stringify({items:[{product:PRODUCTS[product],quantity,unitPrice:100}],discount:0}),STAMP);};
 for(const [code,date,product,quantity] of [['A','2025-07-05',0,1],['B','2025-08-05',0,1],['C','2025-05-05',0,1],['A','2025-10-05',0,6],['C','2025-10-06',1,3],['B','2025-10-07',0,1]])erp('rep1',code,date,product,quantity);
 for(const [code,date,product,quantity] of [['E','2025-09-05',0,2],['E','2025-10-05',0,3]])erp('rep2',code,date,product,quantity);
 erp('rep3','N','2025-10-05',0,2);
 // The sales manager «له كود موظف»: an ERP employee number mapped to him, with an ERP sale of his own in the month.
 sql.prepare('INSERT INTO crm_erp_employee_mappings(employee_id,rep_id,updated_by,updated_at) VALUES(?,?,?,?)').run('E-MGR','mgr','owner',STAMP);
 erp('mgr','M','2025-10-08',0,5,'E-MGR');
 // The management assessments: rep1 complete, the supervisor one conduct score, and the sales manager's «تقييمات قديمة» from before.
 const grade=score=>({score,note:''}),conduct=score=>({responsibility:grade(score),teamwork:grade(score),honesty:grade(score),professionalism:grade(score),appearance:grade(score)});
 const assess=(id,input)=>sql.prepare('INSERT INTO crm_kpi_assessments(member_id,month,input,version,mutation_id,updated_by,updated_at) VALUES(?,?,?,1,?,?,?)').run(id,MONTH,JSON.stringify({reviewed:null,correct:null,review_note:'',...input}),'old-'+id,'owner',STAMP);
 assess('rep1',{conduct:conduct(80)});assess('sup',{conduct:{...conduct(null),responsibility:grade(90)}});assess('mgr',{conduct:conduct(70)});
 const salesApi=await load('app/api/sales/route.mjs'),kpisApi=await load('app/api/kpis/route.mjs'),evidenceApi=await load('app/api/kpi-evidence/route.mjs'),targetsApi=await load('app/api/targets/route.mjs');
 const as=who=>{globalThis.testEnv=env;globalThis.testIdentity=who;};
 const read=async(who,month=MONTH)=>{as(who);const response=await salesApi.GET(new Request('https://test.invalid/api/sales?month='+month+'&kpis=1'));return {status:response.status,data:await response.json()};};
 const post=(url,body)=>new Request('https://test.invalid'+url,{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json'},body:JSON.stringify(body)});
 // rep1's collection, entered in «بيانات المؤشرات» by the administrator through the route.
 as('owner');const options=await (await evidenceApi.GET(new Request('https://test.invalid/api/kpi-evidence?memberId=rep1&month='+MONTH))).json();
 const saved=await evidenceApi.POST(post('/api/kpi-evidence',{memberId:'rep1',month:MONTH,version:0,requestId:'00000000-0000-4000-8000-000000000001',salesRevision:options.salesRevision,evidenceRevision:options.evidenceRevision,input:{collection:{dueCents:100000,collectedCents:80000,reference:'كشف اصطناعي'},history:{complete:false,reference:''},quotationsComplete:false,quotations:[]}}));
 assert.equal(saved.status,200,label+': rep1\'s collection evidence: '+await saved.clone().text());
 return {sql,env,as,read,post,salesApi,kpisApi,evidenceApi,targetsApi};
}

const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,16);
/** What the score depends on, for everyone but the sales manager (whose absence is the change): each person's metrics, summary, attainment,
 *  growth rows, quotations, mark, assessment and sources; and the rest of the answer of /api/sales (the targets tab, the sales tab). */
function digest(data){
 const people={};
 for(const p of data.kpis.people){if(p.member.role==='manager')continue;people[p.member.id]=p.summary.total+' '+sha({metrics:p.metrics,summary:p.summary,attainment:p.attainment,growthRows:p.growthRows,quotations:p.quotations,inactive:p.inactive,assessment:p.assessment,activityTargets:p.activityTargets,activityTargetsKnown:p.activityTargetsKnown,sourceMemberIds:p.sourceMemberIds,salesSourceMemberIds:p.salesSourceMemberIds,teamRollup:p.teamRollup});}
 return {people,rest:sha({sales:data.sales,targets:data.targets,performance:data.performance,individualPerformance:data.individualPerformance,members:data.members,hiddenFromTargets:data.hiddenFromTargets}),canManage:data.kpis.canManage};
}
const VIEWERS=['owner','mgr','sup'];
async function digests(run){const out={};for(const who of VIEWERS){const {status,data}=await run.read(who);assert.equal(status,200,who+' reads the evaluation: '+JSON.stringify(data).slice(0,300));out[who]=digest(data);}return out;}

// ---- 2 (first, so it reads the fixture before anything is saved). The score did not change.
// Made with «--baseline f9fe2bf» (the release before this change: «deploy: update-small-20261116»), which compiled that commit's routes and
// gave these same digests for the representatives and the supervisor, and the same rest of the answer, for every viewer.
const BASELINE={
 owner:{people:{sup:'44.57 64b3742048611d55',rep1:'66.29 d099ffaa4ca2f66b',rep2:'38.38 c2f8f97f5d604d90',rep3:'19.29 f37ff0f224835a91'},rest:'8168b8f0fe4d1ff4',canManage:true},
 mgr:{people:{sup:'44.57 64b3742048611d55',rep1:'66.29 d099ffaa4ca2f66b',rep2:'38.38 c2f8f97f5d604d90',rep3:'19.29 f37ff0f224835a91'},rest:'3f2a3f9d45a48362',canManage:true},
 sup:{people:{sup:'44.57 64b3742048611d55',rep1:'66.29 d099ffaa4ca2f66b',rep2:'38.38 c2f8f97f5d604d90'},rest:'4cec3faf84b1491a',canManage:false}
};
let before=null;
if(baselineRev){
 const tree=path.join(work,'tree-'+baselineRev.replace(/[^\w.-]/g,'_'));fs.mkdirSync(tree,{recursive:true});
 execFileSync('tar',['-x','-C',tree],{input:execFileSync('git',['archive','--format=tar',baselineRev,'app','lib','components'],{cwd:root,maxBuffer:1<<30})});
 const old=await fixture(tree,'before');
 before=await digests(old);
 const oldOwner=(await old.read('owner')).data,oldMgr=(await old.read('mgr')).data;
 ok(oldOwner.kpis.people.some(p=>p.member.id==='mgr')&&oldMgr.kpis.people.some(p=>p.member.id==='mgr'),'before ('+baselineRev+'): the sales manager was a person of the evaluation, on the administrator\'s and his own view');
 old.sql.close();
}
const after=await fixture(root,'after');
const now=await digests(after);
if(printDigest)console.log(JSON.stringify(now,null,1));
await counted('score unchanged',async()=>{
 for(const who of VIEWERS){
  eq(now[who].people,(before||BASELINE)[who].people,who+'\'s view: every representative\'s and supervisor\'s metrics, summary and attainment as before'+(before?' ('+baselineRev+', compared live)':' (the digests of f9fe2bf)'));
  eq(now[who].rest,(before||BASELINE)[who].rest,who+'\'s view: the rest of /api/sales (sales, targets, performance, members) as before');
  eq(now[who].canManage,(before||BASELINE)[who].canManage,who+'\'s view: who may assess, as before');
 }
 if(before)eq(before,BASELINE,'the digests kept here are those of '+baselineRev);
 // The scores themselves, by hand: rep1 66.29, rep2 38.38, rep3 19.29, the supervisor 44.57 (points earned ÷ the weight with data × 100).
 const people=(await after.read('owner')).data.kpis.people;
 for(const p of people){const s=p.summary;ok(Math.abs(s.total-Math.round(s.earned/s.scoredWeight*100*100)/100)<0.011,p.member.id+': total = earned ÷ the weight with data × 100 ('+s.earned+' ÷ '+s.scoredWeight+')');}
});
let views={};for(const who of VIEWERS)views[who]=(await after.read(who)).data;
const grade=score=>({score,note:''}),conduct=score=>({responsibility:grade(score),teamwork:grade(score),honesty:grade(score),professionalism:grade(score),appearance:grade(score)});
const T=library('lib/targets.ts'),G=library('lib/kpi-gaps.ts'),K=library('lib/kpis.ts'),C=library('lib/sales-coverage.ts');

// ---- 1. The sales manager out of the evaluation, the comparison and the customer and visit targets, also with an ERP code and old rows.
await counted('the sales manager out',async()=>{
 const migrations=fs.readdirSync(path.join(root,'drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).sort();
 eq([migrations.length,migrations.at(-1)],[21,'0020_member_permissions.sql'],'no migration: 21, the last 0020_member_permissions.sql');
 eq([T.roleOutOfEvaluation('manager'),T.roleOutOfEvaluation('supervisor'),T.roleOutOfEvaluation('rep'),T.roleOutOfEvaluation('admin'),T.roleOutOfEvaluation(undefined)],[true,false,false,false,false],'only the sales manager\'s role is out');
 const ids=data=>data.kpis.people.map(p=>p.member.id).sort();
 eq(ids(views.owner),['rep1','rep2','rep3','sup'],'the administrator\'s evaluation: everyone but the sales manager');
 eq(ids(views.mgr),['rep1','rep2','rep3','sup'],'the sales manager opens the evaluation on his team, without himself');
 eq(ids(views.sup),['rep1','rep2','sup'],'the supervisor keeps his own row and his representatives');
 const oldRow={...after.sql.prepare("SELECT input,version,mutation_id,updated_by,updated_at FROM crm_kpi_assessments WHERE member_id='mgr'").get()};
 eq([after.sql.prepare("SELECT rep_id FROM crm_erp_employee_mappings WHERE employee_id='E-MGR'").get().rep_id,views.owner.sales.some(s=>s.repId==='mgr'),oldRow.version,JSON.parse(oldRow.input).conduct.honesty.score],['mgr',true,1,70],'he has an ERP employee code, an ERP sale of his own this month and an old assessment of the month, and is still out');
 ok(views.owner.performance.some(p=>p.member.id==='mgr')&&views.owner.targets.sets.some(set=>set.scopeId==='mgr'&&set.kind==='sales'&&set.computed),'the targets tab keeps his products target, computed from his team');
 // Assessing him is refused as for any member out of the evaluation; a representative is assessed as before.
 const assess=async(who,memberId,status,version=0)=>{after.as(who);const response=await after.kpisApi.POST(after.post('/api/kpis',{memberId,month:MONTH,version,requestId:crypto.randomUUID(),input:{reviewed:null,correct:null,review_note:'',conduct:conduct(75)}}));const body=await response.json();eq(response.status,status,who+' assesses '+memberId+': '+JSON.stringify(body).slice(0,200));return body;};
 const outside=await assess('owner','cs',404);
 eq((await assess('owner','mgr',404,1)).error,outside.error,'the administrator assessing the sales manager: the same 404 as a member out of the evaluation («'+outside.error+'»)');
 await assess('mgr','mgr',404,1);await assess('sup','rep1',403,1);await assess(null,'rep2',401);
 await assess('mgr','rep2',200,0);
 eq(after.sql.prepare("SELECT version,updated_by FROM crm_kpi_assessments WHERE member_id='rep2'").get(),{version:1,updated_by:'mgr'},'the sales manager assesses his representative as before');
 eq(after.sql.prepare("SELECT input,version,mutation_id,updated_by,updated_at FROM crm_kpi_assessments WHERE member_id='mgr'").get(),oldRow,'his old assessment is kept exactly as it was');
 // «بيانات المؤشرات» are not read for him.
 const evidence=async(who,memberId)=>{after.as(who);return (await after.evidenceApi.GET(new Request('https://test.invalid/api/kpi-evidence?memberId='+memberId+'&month='+MONTH))).status;};
 eq([await evidence('owner','mgr'),await evidence('mgr','mgr'),await evidence('owner','cs'),await evidence('owner','sup'),await evidence('owner','rep1'),await evidence(null,'rep1')],[404,404,404,200,200,401],'«بيانات المؤشرات»: none for the sales manager (404 as for customer service), the supervisor\'s and a representative\'s as before, 401 without a session');
 // No customer and visit targets for him; his products target stays computed; a representative's is saved as before.
 const saveTarget=async(kind,scopeId,data)=>{after.as('owner');const response=await after.targetsApi.POST(after.post('/api/targets',{kind,scopeId,month:MONTH,version:0,inheritedFrom:null,requestId:crypto.randomUUID(),data}));return [response.status,(await response.json()).error||'ok'];};
 eq(await saveTarget('activity','mgr',{newCustomers:3,recoveredCustomers:1,visits:30}),[400,T.SALES_MANAGER_ACTIVITY_MESSAGE],'his customer and visit targets: refused with the reason');
 eq(await saveTarget('sales','mgr',{products:PRODUCTS.map(product=>({product,quantity:1}))}),[400,'مستهدف المبيعات للمدير والمشرف يُحسب تلقائيًا من إجمالي مستهدفات الفريق.'],'his products target: computed from the team, as before');
 eq(await saveTarget('activity','rep2',{newCustomers:3,recoveredCustomers:1,visits:30}),[200,'ok'],'a representative\'s customer and visit targets: saved as before');
 eq(after.sql.prepare("SELECT COUNT(*) n FROM crm_target_sets WHERE scope_id='mgr'").get().n,0,'nothing saved for him');
 // Who reads the evaluation, as before.
 eq([(await after.read(null)).status,(await after.read('rep1')).status,(await after.read('cs')).status],[401,403,403],'/api/sales?kpis=1: 401 without a session, 403 for a representative and for customer service');
 ok(!(await after.read('owner')).data.kpis.people.some(p=>p.member.id==='mgr'),'still out after the saves');
 eq(after.sql.prepare('PRAGMA foreign_key_check').all(),[],'no dangling rows');
});

// ---- 3. What completes the evaluation (lib/kpi-gaps.ts), on the people the route gave.
const people=views.owner.kpis.people,personOf=id=>people.find(p=>p.member.id===id);
const gapsOf=id=>Object.fromEntries(G.kpiGaps(personOf(id)).map(gap=>[gap.id,[gap.weight,gap.actions.map(action=>action.key+(action.waiting?':'+action.waiting:''))]]));
await counted('what completes the evaluation',async()=>{
 eq(gapsOf('rep2'),{attainment:[25,['target']],collection:[20,['collection']],positive:[2,['rateVisits:1']],conduct:[10,['conduct']]},'rep2: a product without a target, no collection, a visit not rated, no conduct score (the five as one line of 10%)');
 eq(gapsOf('sup'),{attainment:[25,['teamTargets']],collection:[20,['teamCollection']],positive:[2,['rateVisits:1']],teamwork:[2,['conduct']],honesty:[2,['conduct']],professionalism:[2,['conduct']],appearance:[2,['conduct']]},'the supervisor: the team\'s targets and collection, and the four conduct scores still missing one by one');
 eq(gapsOf('rep1'),{positive:[2,['rateVisits:2']]},'rep1: only the two visits the supervisor has not rated');
 const rep3=G.kpiGaps(personOf('rep3')),coverageOf=id=>personOf('rep3').metrics.find(m=>m.id===id).missing;
 eq(rep3.map(gap=>[gap.id,gap.weight]),[['attainment',25],['collection',20],['growth',5],['recovered',5],['retention',5],['positive',2],['conduct',10]],'rep3 (no complete ERP upload): every gap with its weight');
 eq(rep3.find(gap=>gap.id==='attainment').actions.map(action=>action.text),[G.KPI_GAP_TEXT.salesMonth],'rep3\'s attainment: the month\'s complete sales');
 for(const id of ['growth','recovered','retention'])eq(rep3.find(gap=>gap.id===id).actions.map(action=>action.text),[[C.coverageReason(coverageOf(id),'ar'),C.coverageReason(coverageOf(id),'en')]],'rep3\'s '+id+': the months to upload, in both languages');
 for(const p of people)eq(G.kpiGaps(p).reduce((sum,gap)=>sum+gap.weight,0),100-p.summary.covered,p.member.id+': the gaps add up to the weight without data');
 eq(people.map(p=>[p.member.id,G.kpiMissing(p.metrics).map(row=>row.id)]),people.map(p=>[p.member.id,p.summary.missing.length===5&&p.summary.missing.every(id=>K.conductKeys.includes(id))?['conduct']:[...p.summary.missing.filter(id=>!K.conductKeys.includes(id)),...(p.summary.missing.filter(id=>K.conductKeys.includes(id)).length===5?['conduct']:p.summary.missing.filter(id=>K.conductKeys.includes(id)))]]),'«بيانات ناقصة» names exactly what kpiSummary leaves out (the five conduct indicators as one when all are missing)');
 // «لا ينطبق» is never missing; a case not listed keeps the indicator's own reason; the other cases.
 const base=structuredClone(personOf('rep1'));
 const variant=(change,extra={})=>{const p=structuredClone(base);Object.assign(p,extra);for(const [id,values] of Object.entries(change))Object.assign(p.metrics.find(m=>m.id===id),{score:null,points:null,status:'missing',...values});return p;};
 const na=structuredClone(base);Object.assign(na.metrics.find(m=>m.id==='documentation'),{score:null,points:null,status:'not_applicable'});
 eq(G.kpiMissing(na.metrics).map(row=>row.id),['positive'],'«لا ينطبق» is not missing data');
 const ids=(p,id)=>G.kpiGaps(p).find(gap=>gap.id===id).actions.map(action=>action.key);
 eq(ids(variant({new_customers:{reason:'مستهدفات النشاط غير مكتملة لهذا النطاق.'}},{activityTargetsKnown:false}),'new_customers'),['reason:new_customers:مستهدفات النشاط غير مكتملة لهذا النطاق.'],'a case not listed keeps the indicator\'s own reason');
 eq(ids(variant({new_customers:{reason:'بعض العملاء المضافين في الشهر لا يحملون هوية منشئهم ولا تاريخ إنشائهم في ERP؛ لا تُنسب إضافتهم للمسؤول الحالي بالتخمين.'}}),'new_customers'),['newCustomers'],'new customers without a creator: the ERP customers file');
 for(const reason of G.HISTORY_REASONS)eq(ids(variant({retention:{reason}}),'retention'),['salesCustomers'],'retention waiting for the history: the complete sales of the four months, or the confirmation');
 eq(ids(variant({retention:{reason:'توجد فواتير بدون رقم عميل أو أرقام عملاء مكررة بين مصادر المبيعات؛ راجع هوية العملاء أولًا.'}}),'retention'),['reason:retention:توجد فواتير بدون رقم عميل أو أرقام عملاء مكررة بين مصادر المبيعات؛ راجع هوية العملاء أولًا.'],'unknown customer codes: its own reason');
 const lonely=variant({attainment:{},collection:{},orders:{reason:G.NO_TEAM_REASONS[1]},retention:{reason:G.NO_TEAM_REASONS[0]}},{teamRollup:true,salesSourceMemberIds:[]});
 eq(['attainment','collection','orders','retention'].map(id=>ids(lonely,id)),[['teamLink'],['teamLink'],['teamLink'],['teamLink']],'a supervisor without a team: link the team first');
 eq(ids(variant({attainment:{}},{attainment:{...base.attainment,status:'weights_missing'}}),'attainment'),['weights'],'no weights: the weights');
 eq(ids(variant({growth:{}},{growthRows:base.growthRows.map((row,i)=>i?row:{...row,weight:null})}),'growth'),['weights'],'growth without weights: the weights');
 eq(ids(variant({growth:{}}),'growth'),['salesGrowth'],'growth without the previous month: the two months\' complete sales');
 eq(ids(variant({attainment:{}},{attainment:{...base.attainment,status:'missing_inputs',rows:base.attainment.rows.map((row,i)=>i===0?{...row,target:null}:i===1?{...row,actual:null}:row)}}),'attainment'),['target','salesMonth'],'a product without a target and another without its sales: both actions');
 eq(G.kpiGaps(variant({responsibility:{},teamwork:{},honesty:{},professionalism:{},appearance:{}})).filter(gap=>gap.id==='conduct').map(gap=>[gap.name,gap.weight]),[[G.CONDUCT_GAP_NAME,10]],'the five conduct scores missing: «تقييم السلوك من الإدارة» (10%)');
 eq(G.kpiGaps({metrics:K.operationalIndicators.map(i=>K.metric(i.id,70,'x'))}),[],'nothing missing, nothing listed');
 // The summary above the table.
 const summary=G.kpiGapSummary(people);
 eq(summary.people,4,'four people listed');
 eq(summary.lines.map(line=>[line.action.key.startsWith('coverage')?'coverage':line.action.key,line.weight,line.people.map(p=>p.id),line.waiting]),[['salesMonth',25,['rep3'],0],['target',25,['rep2'],0],['teamTargets',25,['sup'],0],['collection',20,['rep2','rep3'],0],['teamCollection',20,['sup'],0],['conduct',10,['sup','rep2','rep3'],0],['coverage',5,['rep3'],0],['coverage',5,['rep3'],0],['coverage',5,['rep3'],0],['rateVisits',2,['sup','rep1','rep2','rep3'],5]],'one line per action, the weight of the indicators it completes, the people, the visits waiting; the most weight first');
 eq(G.kpiGapSummary([...people,{...structuredClone(personOf('rep2')),member:{id:'quiet',name:'Quiet'},summary:{...personOf('rep2').summary,inactive:true}}]).people,4,'a person out of the month (inactive) is left out');
 // The words: the server's reasons it matches are still written so, and every action has its English.
 const server=fs.readFileSync(path.join(root,'lib/kpis.ts'),'utf8')+fs.readFileSync(path.join(root,'lib/kpis-server.ts'),'utf8');
 for(const reason of [...G.NO_TEAM_REASONS,...G.HISTORY_REASONS,G.NEW_CUSTOMERS_UNKNOWN_START])ok(server.includes(reason),'the server still writes «'+reason+'»');
 for(const [key,[ar,en]] of Object.entries({...G.KPI_GAP_TEXT,...G.KPI_GAP_WORDS})){ok(ARABIC.test(ar)&&!ARABIC.test(en)&&en.length>5,key+': Arabic and its English');ok(!/(^|[\s«(])(مش|ده|دي|علشان|عشان|لسه|عايز|إيه|ايه|كده|بتاع|اللي)(?=$|[\s».،:)])/.test(ar),key+': Modern Standard Arabic');}
 eq(G.gapActionText({key:'x',text:['نص.','Text.'],waiting:3},'en',value=>value),'Text (Visits awaiting rating: 3)','an action without its full stop, with the visits waiting');
});

// ---- 4. The screens with the real answer of the route.
const i18nLib=library('lib/i18n.ts');i18nLib.installEnglish(JSON.parse(fs.readFileSync(path.join(root,'lib/locales/en.json'),'utf8')));
let language='ar';
const t=value=>typeof value==='string'?i18nLib.translateText(value,language):value;
const i18n={t,useLanguage:()=>({language}),getLanguage:()=>language,direction:()=>language==='ar'?'rtl':'ltr'};
const icons=new Proxy({},{get:()=>()=>null}),pass=({children})=>children??null;
const table=Object.fromEntries(Object.entries({Table:'table',TableHeader:'thead',TableHead:'th',TableRow:'tr',TableBody:'tbody',TableCell:'td'}).map(([name,tag])=>[name,({children,...props})=>React.createElement(tag,props,children)]));
const screens=new Map();
function imports(name){
 if(name==='react')return React;if(name==='react/jsx-runtime')return jsx;if(name==='@/lib/i18n')return i18n;if(name==='lucide-react')return icons;if(name==='sonner')return {toast:{success(){}}};
 if(['./voice-field','./kpi-evidence-editor','./record-import'].includes(name))return {__esModule:true,default:()=>null};
 if(name==='./target-gauge')return screen('app/target-gauge.tsx');if(name==='./targets-performance-summary')return screen('app/targets-performance-summary.tsx');
 if(name==='@/components/ui/table')return table;if(name==='@/components/ui/progress')return {Progress:()=>null};if(name.startsWith('@/components/'))return new Proxy({},{get:()=>pass});
 if(name.startsWith('@/lib/'))return library(name.replace('@/','')+'.ts');if(name.endsWith('.css'))return {};
 throw Error('Unexpected import '+name);
}
function screen(file){if(!screens.has(file))screens.set(file,vmLoad(file,imports));return screens.get(file);}
const KpiPerformanceView=screen('app/kpi-performance.tsx').default,Summary=screen('app/targets-performance-summary.tsx'),TargetsWorkspace=screen('app/targets-workspace.tsx').default;
const plain=html=>html.replace(/<[^>]+>/g,'').replace(/&#x27;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
const names=[...views.owner.members.map(m=>m.name),'الرئيسي'];
const arabicLeft=html=>{let text=plain(html);for(const name of names)text=text.split(name).join('');return text.match(/[^\s]*[؀-ۿ][^\s]*/g)||[];};
const section=(html,marker)=>{const at=html.indexOf(marker);if(at<0)return '';const open=html.lastIndexOf('<',at),tag=html.slice(open+1).match(/^\w+/)[0],re=new RegExp('<(/?)'+tag+'\\b[^>]*>','g');re.lastIndex=open;let depth=0,m;while((m=re.exec(html))){depth+=m[1]?-1:1;if(depth===0)return html.slice(open,re.lastIndex);}return html.slice(open);};
const view=(staff,data=views.owner.kpis)=>renderToStaticMarkup(React.createElement(KpiPerformanceView,{data,staff,query:'',members:views.owner.members,onSelect(){},onSaved(){},identityKey:'owner'}));
const cut=pair=>pair[language==='en'?1:0].replace(/\.$/,'');
await counted('screens',async()=>{
 for(language of ['ar','en']){
  const say=(ar,en)=>language==='en'?en:ar,sep=say('، ',', '),missing=say('بيانات ناقصة','Missing data');
  // The comparison: the box above the table, then the names with their weights under each incomplete score.
  const html=view('all'),box=section(html,'data-kpi-gaps-summary'),boxText=plain(box);
  ok(box&&html.indexOf('data-kpi-gaps-summary')<html.indexOf('<table'),'the box «المطلوب لاكتمال التقييم» sits above the comparison ('+language+')');
  ok(boxText.startsWith(say('المطلوب لاكتمال التقييم','What completes the evaluation')),'its title ('+language+')');
  for(const line of [cut(G.KPI_GAP_TEXT.salesMonth)+' — 25%اسم rep3',cut(G.KPI_GAP_TEXT.target)+' — 25%اسم rep2',cut(G.KPI_GAP_TEXT.collection)+' — 20%اسم rep2'+sep+'اسم rep3',cut(G.KPI_GAP_TEXT.conduct)+' — 10%اسم sup'+sep+'اسم rep2'+sep+'اسم rep3',cut(G.KPI_GAP_TEXT.rateVisits)+' ('+say('زيارات بانتظار التقييم','Visits awaiting rating')+': 5) — 2%'+say('كل المناديب','All sales reps')+' (4)'])ok(boxText.includes(line),'the box\'s line ('+language+'): '+line);
  ok(!boxText.includes('اسم mgr')&&!plain(html).includes('اسم mgr'),'no sales manager anywhere in the comparison ('+language+')');
  const rows=html.split('<tr').slice(2).map(row=>plain('<tr'+row)),row=id=>rows.find(r=>r.startsWith('اسم '+id));
  ok(row('rep2').includes(missing+': '+t('تحقيق المستهدف البيعي')+' (25%)'+sep+t('التحصيل')+' (20%)'+sep+t('نسبة الزيارات الفعالة')+' (2%)'+sep+t('تقييم السلوك من الإدارة')+' (10%)'),'rep2\'s row: «بيانات ناقصة» with the names and weights ('+language+'): '+row('rep2'));
  ok(row('sup').includes(t('التعاون والعمل الجماعي')+' (2%)')&&!row('sup').includes(t('الالتزام والمسؤولية'))&&!row('sup').includes(t('تقييم السلوك من الإدارة')),'the supervisor\'s row names the conduct scores still missing one by one ('+language+')');
  ok(row('rep1').includes(missing+': '+t('نسبة الزيارات الفعالة')+' (2%)'),'rep1\'s row ('+language+')');
  eq((html.match(/data-kpi-missing-list/g)||[]).length,4,'every incomplete row has its list ('+language+')');
  // The person's page: the checklist.
  const page=view('rep3'),notice=section(page,'kpi-partial-notice'),list=plain(notice);
  ok(list.includes(say('المطلوب لاكتمال التقييم','What completes the evaluation')+':'),'the person\'s page: the checklist ('+language+')');
  ok(list.includes(t('تحقيق المستهدف البيعي')+' (25%): '+cut(G.KPI_GAP_TEXT.salesMonth)),'checklist: attainment ('+language+')');
  ok(list.includes(t('التحصيل')+' (20%): '+cut(G.KPI_GAP_TEXT.collection)),'checklist: collection ('+language+')');
  ok(list.includes(t('الحفاظ على العملاء الحاليين')+' (5%): '+C.coverageReason(personOf('rep3').metrics.find(m=>m.id==='retention').missing,language).replace(/\.$/,'')),'checklist: retention names the months to upload ('+language+')');
  ok(list.includes(t('نسبة الزيارات الفعالة')+' (2%): '+cut(G.KPI_GAP_TEXT.rateVisits)+' ('+say('زيارات بانتظار التقييم','Visits awaiting rating')+': 1)'),'checklist: the visits waiting ('+language+')');
  ok(list.includes(t('تقييم السلوك من الإدارة')+' (10%): '+cut(G.KPI_GAP_TEXT.conduct)),'checklist: conduct ('+language+')');
  eq((notice.match(/data-kpi-gap="/g)||[]).length,7,'seven items for rep3 ('+language+')');
  // The summary cards: the names with their weights.
  const cards=renderToStaticMarkup(React.createElement(Summary.default,{people,month:MONTH,future:false,productId:PRODUCTS[0],onProductChange(){},onDetails(){}}));
  ok(plain(cards).includes(missing+': '+t('تحقيق المستهدف البيعي')+' (25%)'+sep+t('التحصيل')+' (20%)'),'the cards name the missing indicators with their weights ('+language+')');
  ok(!plain(cards).includes('اسم mgr'),'no card for the sales manager ('+language+')');
  // The targets page: no customer and visit targets for him; his products target stays.
  const owner=views.owner.members.find(m=>m.id==='owner');
  const targetsHtml=renderToStaticMarkup(React.createElement(TargetsWorkspace,{state:views.owner.targets,members:views.owner.members,me:owner,staff:'all',query:'',branch:'__all__',onBranchChange(){},onSaved(){},hidden:views.owner.hiddenFromTargets,performance:views.owner.performance}));
  const activity=plain(section(targetsHtml,'target-activity-panel')),card=section(targetsHtml,'data-scope="mgr"');
  ok(activity.includes('اسم rep1')&&activity.includes('اسم sup')&&!activity.includes('اسم mgr'),'«مستهدفات العملاء والزيارات»: everyone but the sales manager ('+language+')');
  ok(card&&!card.includes('target-card-activity')&&plain(card).includes(say('مدير المبيعات خارج التقييم ومستهدفات العملاء والزيارات.','The sales manager is outside the evaluation and the customer and visit targets.')),'his card: no customer and visit targets, and why ('+language+')');
  ok(plain(card).includes(t('محسوب من الفريق')),'his products target is still computed from his team ('+language+')');
  ok(section(targetsHtml,'data-scope="sup"').includes('target-card-activity'),'the supervisor\'s card keeps its customer and visit targets ('+language+')');
  if(language==='en')for(const [label,part] of [['the box',box],['the comparison',html],['the checklist',notice],['the cards',cards],['the targets page',targetsHtml]])eq(arabicLeft(part),[],'no Arabic left in English but names: '+label);
 }
 language='ar';
 // The two exports.
 const E=library('lib/targets-export.ts'),targetRows=E.targetsCsvRows(views.owner.targets,views.owner.members,MONTH,t,views.owner.hiddenFromTargets);
 ok(!targetRows.some(row=>row[1]==='اسم mgr'&&row[2]==='مستهدفات العملاء والزيارات')&&targetRows.some(row=>row[1]==='اسم mgr'&&row[2]==='مستهدفات الأصناف'),'«تصدير كل المستهدفات»: his products target, no customer and visit targets');
 ok(targetRows.some(row=>row[1]==='اسم sup'&&row[2]==='مستهدفات العملاء والزيارات'),'the supervisor\'s are there');
 for(const lang of ['ar','en']){language=lang;const rows=E.performanceCsvRows(people,MONTH,t,lang),overall=rows.find(row=>row[1]==='اسم rep2'&&row[2]===t('درجة التقييم الكلية'));
  ok(String(overall[6]).includes(lang==='en'?'Missing data: Sales target achievement (25%), Collections (20%), Effective visit rate (2%), Conduct assessment by management (10%)':'بيانات ناقصة: تحقيق المستهدف البيعي (25%)، التحصيل (20%)، نسبة الزيارات الفعالة (2%)، تقييم السلوك من الإدارة (10%)'),'«تصدير التقييم»: the names with their weights ('+lang+'): '+overall[6]);
  eq(overall[4],personOf('rep2').summary.total,'and the same score ('+lang+')');
  ok(!rows.some(row=>row[1]==='اسم mgr'),'no row for the sales manager ('+lang+')');}
 language='ar';
});
after.sql.close();
console.log(JSON.stringify({ok:true,checks,counts,baseline:baselineRev||'f9fe2bf digests',scope:'GSCO list item 2: the sales manager out of the evaluation, the comparison and the customer and visit targets (also with an ERP code and old rows, kept); the score unchanged for the representatives and supervisors; what completes the evaluation (names and weights, the box above the comparison, the person\'s checklist); real routes on SQLite and the real components, Arabic and English',syntheticOnly:true}));
