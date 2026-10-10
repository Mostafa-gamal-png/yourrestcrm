import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
// Actual sales GET -> targetState -> KPI projections with synthetic SQLite records.
const root=process.cwd(),runtime=path.join(root,'.sites-runtime');fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'erp-kpi-')),seen=new Set();process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const id=globalThis.testIdentity;if(!id)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version,email FROM crm_members WHERE id=?').bind(id).first();return {memberId:m?.id,memberVersion:m?.auth_version,email:m?.email};}`);
fs.writeFileSync(path.join(out,'parser.mjs'),`export class ErpWorkbookError extends Error{}; export function parseErpWorkbook(){throw Error('No upload parser belongs in KPI reads');}`);
function compile(relative){if(seen.has(relative))return;seen.add(relative);const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));if(imp==='./erp-sales')return 'from '+JSON.stringify(path.join(out,'parser.mjs'));if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;let rel=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));if(!/\.tsx?$/.test(rel))rel+=fs.existsSync(path.join(root,rel+'.ts'))?'.ts':'.tsx';compile(rel);return 'from '+JSON.stringify(path.join(out,rel.replace(/\.tsx?$/,'.mjs')));});fs.writeFileSync(dest,code);}
compile('app/api/sales/route.ts');
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+f,'utf8'));
class Statement{constructor(q,a=[]){this.q=q;this.a=a;}bind(...a){return new Statement(this.q,a);}async run(){throw Error('KPI GET must not write');}async all(){return {results:sql.prepare(this.q).all(...this.a)};}async first(){return sql.prepare(this.q).get(...this.a)||null;}}
globalThis.testEnv={DB:{prepare:q=>new Statement(q)},YR_APP_ORIGIN:'https://test.invalid',YR_AUTH_SECRET:'a'.repeat(64)};
const now='2025-01-01T00:00:00.000Z';
const member=(id,role,region='eastern',supervisor='sup',active=1)=>sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,?,0,?)').run(id,'u-'+id,id+'@yourrest.org',id,role,'الفرع',supervisor,region,active,now);
member('admin','admin','all','');member('manager','manager','eastern','');member('sup','supervisor','eastern','manager');member('rep','rep');member('other','rep','eastern','other-sup');member('west','rep','western','sup');member('inactive','rep','eastern','sup',0);
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-admin')").run();
const api=await import(path.join(out,'app/api/sales/route.mjs'));
const {salesProducts}=await import(path.join(out,'lib/sales.mjs'));
const {kpiPeriod}=await import(path.join(out,'lib/kpis.mjs'));
const {today}=await import(path.join(out,'lib/crm.mjs'));
const items=(quantities)=>quantities.map((quantity,i)=>({product:salesProducts[i],quantity,unitPrice:100,description:'test'}));
const target=(kind,scopeId,month,data)=>sql.prepare('INSERT INTO crm_target_sets(kind,scope_id,month,data,version,mutation_id,updated_by,updated_at) VALUES(?,?,?,?,1,?,?,?)').run(kind,scopeId,month,JSON.stringify(data),'fixture','admin',now);
const assign=month=>{target('sales','rep',month,{products:salesProducts.map(product=>({product,quantity:10}))});target('weights','company',month,{products:salesProducts.map((product,i)=>({product,weight:[50,30,20][i]||0}))});};
assign('2025-02');
sql.prepare("INSERT INTO crm_records(id,kind,assigned_to,branch,data,created_at,updated_at) VALUES('factory','customer','rep','الفرع',?,?,?)").run(JSON.stringify({name:'Factory',region:'الشرقية'}),now,now);
const manual=(id,date,quantity,status='confirmed')=>sql.prepare("INSERT INTO crm_sales(id,customer_id,rep_id,branch,date,reference,reference_key,data,total_cents,status,void_reason,version,mutation_id,create_fingerprint,created_by,created_at,updated_at) VALUES(?,'factory','rep','الفرع',?,?,?,?,?,?,'',1,'fixture','fixture','admin',?,?)").run(id,date,id,id,JSON.stringify({items:items([quantity]),discount:0}),quantity*10000,status,now,now);
sql.prepare("INSERT INTO crm_erp_imports(id,actor_id,fingerprint,file_name,result,created_at) VALUES('fixture','admin','fixture','fixture.xlsx','{}',?)").run(now);
const erp=(id,date,quantities,rep='rep',region='eastern',type='sale')=>sql.prepare("INSERT INTO crm_erp_sales(id,document_key,content_hash,mapped_hash,reference,document_type,date,employee_id,rep_id,branch,region_scope,customer_code,customer_name,data,total_cents,import_id,created_by,created_at) VALUES(?,?,'hash','mapped',?,?,?,'E1',?,'الفرع',?,'C1','Factory',?,?,'fixture','admin',?)").run(id,id,id,type,date,rep,region,JSON.stringify({items:items(quantities),discount:0}),quantities.reduce((sum,n)=>sum+n,0)*10000,now);
manual('prior-manual','2025-01-12',2);manual('current-manual','2025-02-12',3);manual('void-manual','2025-02-12',999,'void');
erp('prior-sale','2025-01-10',[10,10,10]);erp('prior-return','2025-01-11',[-2,-2,-2],'rep','eastern','return');
erp('current-sale','2025-02-10',[15,10,10]);erp('current-return','2025-02-11',[-3,-2,-2],'rep','eastern','return');
for(const [rep,region] of [['other','eastern'],['west','western']]){erp('hidden-prior-'+rep,'2025-01-15',[9999,9999,9999],rep,region);erp('hidden-current-'+rep,'2025-02-15',[9999,9999,9999],rep,region);}
erp('inactive-prior','2025-01-20',[1,1,1],'inactive');
let checks=0;const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
async function read(identity='sup',month='2025-02',status=200){globalThis.testIdentity=identity;const response=await api.GET(new Request('https://test.invalid/api/sales?month='+month+'&kpis=1'));const data=await response.json();eq(response.status,status,JSON.stringify(data));return data;}
let data=await read();let rep=data.kpis.people.find(p=>p.member.id==='rep');
eq(rep.attainment.rows.slice(0,3).map(r=>r.actual),[15,8,8],'ERP + manual quantities net of current returns');
eq(rep.attainment.score,90,'ERP quantities feed existing weighted target score');
eq(rep.growthRows.slice(0,3).map(r=>r.previous),[10,8,8],'Previous-period manual + ERP include signed returns');
eq(rep.growthRows.slice(0,3).map(r=>r.growth),[50,0,0]);
eq(rep.metrics.find(m=>m.id==='growth').score,25,'Growth uses product weights and signed prior baseline');
const variety=rep.metrics.find(m=>m.id==='variety');eq([variety.numerator,variety.denominator,variety.score],[1,2,50],'Returns do not add variety invoices');
eq(data.performance.find(p=>p.member.id==='rep').total,3100,'Financial performance includes signed returns');
eq(data.sales.filter(s=>s.repId==='rep'&&s.status==='confirmed').length,3);
eq(data.kpis.people.some(p=>p.member.id==='other'||p.member.id==='west'),false,'Supervisor team and regional limits preserved');
eq(data.sales.some(s=>s.repId==='other'||s.repId==='west'),false);
eq(data.kpis.people.find(p=>p.member.id==='sup').salesSourceMemberIds.includes('inactive'),true,'Inactive ERP prior-period seller remains in rollup');
eq(data.kpis.people.find(p=>p.member.id==='sup').growthRows[0].previous,11,'Inactive ERP history enters supervisor baseline');
await read('rep','2025-02',403);await read(null,'2025-02',401);
// The current month compares only through the same day of the prior month.
const current=today().slice(0,7),period=kpiPeriod(current);assign(current);
erp('current-cutoff-sale',period.first,[4,4,4]);erp('cutoff-baseline-sale',period.previousFirst,[2,2,2]);erp('cutoff-baseline-return',period.previousFirst,[-1,-1,-1],'rep','eastern','return');
const afterPrevious=new Date(period.previousEnd+'T12:00:00Z');afterPrevious.setUTCDate(afterPrevious.getUTCDate()+1);const afterDate=afterPrevious.toISOString().slice(0,10);
if(afterDate.slice(0,7)===period.previousFirst.slice(0,7))erp('late-baseline',afterDate,[9999,9999,9999]);
data=await read('sup',current);rep=data.kpis.people.find(p=>p.member.id==='rep');
eq(rep.growthRows.slice(0,3).map(r=>r.previous),[1,1,1],'Comparison cutoff excludes later prior-month ERP documents');
eq(rep.metrics.find(m=>m.id==='variety').denominator,1);
eq(sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');sql.close();
console.log(JSON.stringify({ok:true,checks,scope:'ERP manual combined KPI HTTP route, signed returns, variety, prior period cutoff, weighted attainment and team-region limits'}));
