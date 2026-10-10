import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';

// Authenticated HTTP handlers and real migrated SQLite, with synthetic data only.
// This complements the endpoint guard suite by exercising saved evidence all the
// way through the combined sales/targets/KPI response used by the application.
const root=process.cwd(),runtime=path.join(root,'.sites-runtime');fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'kpi-complete-')),seen=new Set();
process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const id=globalThis.testIdentity;if(!id)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version,email FROM crm_members WHERE id=?').bind(id).first();return {memberId:m?.id,memberVersion:m?.auth_version,email:m?.email};}`);
fs.writeFileSync(path.join(out,'parser.mjs'),`export class ErpWorkbookError extends Error{};export function parseErpWorkbook(){throw Error('KPI reads cannot invoke the workbook parser');}`);
function compile(relative){
 if(seen.has(relative))return;seen.add(relative);
 const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});
 let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
  if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));
  if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));
  if(imp==='./erp-sales')return 'from '+JSON.stringify(path.join(out,'parser.mjs'));
  if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
  let rel=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
  if(!/\.tsx?$/.test(rel))rel+=fs.existsSync(path.join(root,rel+'.ts'))?'.ts':'.tsx';
  compile(rel);return 'from '+JSON.stringify(path.join(out,rel.replace(/\.tsx?$/,'.mjs')));
 });fs.writeFileSync(dest,code);
}
for(const file of ['app/api/sales/route.ts','app/api/kpi-evidence/route.ts','app/api/kpis/route.ts'])compile(file);
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const file of fs.readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+file,'utf8'));
class Statement{
 constructor(q,a=[]){this.q=q;this.a=a;}
 bind(...a){return new Statement(this.q,a);}
 async run(){const result=sql.prepare(this.q).run(...this.a);return{meta:{changes:Number(result.changes)}};}
 async all(){return{results:sql.prepare(this.q).all(...this.a)};}
 async first(){return sql.prepare(this.q).get(...this.a)||null;}
}
const DB={prepare:q=>new Statement(q),batch:async statements=>{sql.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid',YR_AUTH_SECRET:'a'.repeat(64)};
const salesApi=await import(path.join(out,'app/api/sales/route.mjs'));
const evidenceApi=await import(path.join(out,'app/api/kpi-evidence/route.mjs'));
const assessmentApi=await import(path.join(out,'app/api/kpis/route.mjs'));
const {salesProducts}=await import(path.join(out,'lib/sales.mjs'));
const {conductKeys}=await import(path.join(out,'lib/kpis.mjs'));
const now='2024-01-01T00:00:00.000Z',month='2025-05';
let checks=0;const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
const ok=(a,message)=>{assert.ok(a,message);checks++;};
function member(id,role='rep',region='eastern',supervisor='sup'){
 sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,1,0,?)').run(id,'u-'+id,id+'@yourrest.org',id,role,'HQ',supervisor,region,now);
}
member('admin','admin','all','');member('manager','manager','eastern','');member('sup','supervisor','eastern','manager');member('rep');member('rep2');
member('other','rep','eastern','unrelated-supervisor');member('west','rep','western','sup');
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-admin')").run();
function record(id,kind,parent,assigned,data){
 sql.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id,kind,parent,assigned,'HQ',JSON.stringify(data),now,now);
}
for(const id of ['keep','recover','return-only','net-zero','dropped','rep2-recover'])record(id,'customer',null,id==='rep2-recover'?'rep2':'rep',{name:'Synthetic '+id,code:id.toUpperCase(),region:'الشرقية',_createdBy:'rep'});
record('west-customer','customer',null,'west',{name:'Private western customer',code:'WEST',region:'الغربية',_createdBy:'west'});
record('other-customer','customer',null,'other',{name:'Unrelated eastern customer',code:'OTHER',region:'الشرقية',_createdBy:'other'});
const items=quantity=>[{product:salesProducts[0],quantity,unitPrice:100,description:'Synthetic mold'}];
function manual(id,{customer='keep',rep='rep',date='2025-05-15',quantity=1,status='confirmed'}={}){
 sql.prepare("INSERT INTO crm_sales(id,customer_id,rep_id,branch,date,reference,reference_key,data,total_cents,status,void_reason,version,mutation_id,create_fingerprint,created_by,created_at,updated_at) VALUES(?,?,?,'HQ',?,?,?,?,?,?,'',1,'fixture','fixture','admin',?,?)").run(id,customer,rep,date,id,id,JSON.stringify({items:items(quantity),discount:0}),quantity*10000,status,now,now);
}
sql.prepare("INSERT INTO crm_erp_imports(id,actor_id,fingerprint,file_name,result,created_at) VALUES('fixture','admin','fixture','synthetic.xlsx','{}',?)").run(now);
function erp(id,{code='KEEP',rep='rep',date='2025-05-15',quantity=1,region='eastern',type='sale'}={}){
 sql.prepare("INSERT INTO crm_erp_sales(id,document_key,content_hash,mapped_hash,reference,document_type,date,employee_id,rep_id,branch,region_scope,customer_code,customer_name,data,total_cents,import_id,created_by,created_at) VALUES(?,?,'hash','mapped',?,?,?,'E1',?,'HQ',?,?,'Synthetic ERP customer',?,?,'fixture','admin',?)").run(id,id,id,type,date,rep,region,code,JSON.stringify({items:items(quantity),discount:0}),quantity*10000,now);
}
// Prior-three-month buyers: KEEP and DROPPED. RECOVER last purchased four
// months ago. Returns and fully reversed months must not create buyers.
manual('keep-prior',{date:'2025-04-15'});erp('keep-current');
manual('recover-prior',{customer:'recover',date:'2025-01-15'});erp('recover-current',{code:'RECOVER'});
manual('return-only-prior',{customer:'return-only',date:'2025-01-15'});erp('return-only-current',{code:'RETURN-ONLY',type:'return',quantity:-1});
erp('net-zero-prior-sale',{code:'NET-ZERO',date:'2025-04-15'});erp('net-zero-prior-return',{code:'NET-ZERO',date:'2025-04-16',type:'return',quantity:-1});manual('net-zero-current',{customer:'net-zero'});
erp('dropped-prior',{code:'DROPPED',date:'2025-03-15'});
// The shared retained buyer counts once in team customer metrics, while money
// and independently entered recovery targets sum across the two representatives.
erp('rep2-keep-prior',{rep:'rep2',date:'2025-04-15'});manual('rep2-keep-current',{rep:'rep2'});
erp('rep2-recovered-prior',{rep:'rep2',code:'REP2-RECOVER',date:'2025-01-15'});manual('rep2-recovered-current',{rep:'rep2',customer:'rep2-recover'});
manual('void-current',{status:'void',quantity:999});
for(const [rep,code,region,customer] of [['other','OTHER','eastern','other-customer'],['west','WEST','western','west-customer']]){
 erp('hidden-prior-'+rep,{rep,code,region,date:'2025-04-15',quantity:9999});manual('hidden-current-'+rep,{rep,customer,quantity:9999});
}
function quote(id,customer,rep){record(id,'quote',customer,rep,{performedBy:rep,number:'Q-'+id,date:'2025-05-05',status:'sent',items:[{description:'Mold',quantity:1,price:100}],total:100});}
quote('quote-erp','keep','rep');quote('quote-not-converted','recover','rep');quote('quote-manual','rep2-recover','rep2');
function target(kind,id,data){sql.prepare('INSERT INTO crm_target_sets(kind,scope_id,month,data,version,mutation_id,updated_by,updated_at) VALUES(?,?,?,?,1,?,?,?)').run(kind,id,'2025-01',JSON.stringify(data),'fixture','admin',now);}
for(const id of ['rep','rep2']){
 target('sales',id,{products:salesProducts.map((product,i)=>({product,quantity:i<2?1:0}))});
 target('activity',id,{newCustomers:2,recoveredCustomers:id==='rep'?2:1,visits:2});
}
target('weights','company',{products:salesProducts.map((product,i)=>({product,weight:[50,30,20][i]||0}))});
async function responseJson(response,status){const data=await response.json();eq(response.status,status,JSON.stringify(data));return data;}
const jsonRequest=(url,body)=>new Request('https://test.invalid'+url,{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json'},body:JSON.stringify(body)});
async function evidence(memberId='rep',status=200){return responseJson(await evidenceApi.GET(new Request('https://test.invalid/api/kpi-evidence?'+new URLSearchParams({memberId,month}))),status);}
async function evidenceBody(memberId,input){const s=await evidence(memberId);return{memberId,month,version:s.evidence?.version||0,requestId:crypto.randomUUID(),salesRevision:s.salesRevision,evidenceRevision:s.evidenceRevision,input};}
async function saveEvidence(memberId,input){const body=await evidenceBody(memberId,input);await responseJson(await evidenceApi.POST(jsonRequest('/api/kpi-evidence',body)),200);return body;}
async function read(actor='sup',status=200){globalThis.testIdentity=actor;return responseJson(await salesApi.GET(new Request('https://test.invalid/api/sales?month='+month+'&kpis=1')),status);}
const person=(data,id='rep')=>data.kpis.people.find(row=>row.member.id===id);
const metric=(data,id,memberId='rep')=>person(data,memberId).metrics.find(row=>row.id===id);
const input=(rep='rep',complete=true)=>({collection:{dueCents:rep==='rep'?20000:10000,collectedCents:10000,reference:'Synthetic approved collection ledger'},history:{complete,reference:complete?'Reconciled complete ERP and manual history':''},quotationsComplete:complete,quotations:rep==='rep'?[{quoteId:'quote-erp',saleId:'keep-current'},{quoteId:'quote-not-converted',saleId:null}]:[{quoteId:'quote-manual',saleId:'rep2-recovered-current'}]});

let data=await read();
for(const id of ['collection','recovered','retention','orders'])eq(metric(data,id).status,'missing','Unconfirmed '+id+' cannot produce an invented score');
eq(person(data).attainment.rows[1].actual,null,'An absent product remains unknown before completeness confirmation');
eq(person(data).summary.complete,false);eq(person(data).summary.total,null);
globalThis.testIdentity='admin';
// Partial history is saved, but does not turn customer cohorts or absent sales
// products into known quantities. Collection is independently available.
await saveEvidence('rep',input('rep',false));data=await read();
eq(metric(data,'collection').score,50);eq(metric(data,'retention').status,'missing');eq(metric(data,'recovered').status,'missing');eq(metric(data,'orders').status,'missing');
eq(person(data).attainment.rows[1].actual,null);
globalThis.testIdentity='admin';const first=await saveEvidence('rep',input());
const saved=await evidence();eq(saved.evidence.input,input(),'Save/reload preserves the approved input');
const revision=saved.evidenceRevision,version=saved.evidence.version;
await responseJson(await evidenceApi.POST(jsonRequest('/api/kpi-evidence',first)),200);
const replayed=await evidence();eq(replayed.evidenceRevision,revision,'Response-loss retry does not increment the global revision');eq(replayed.evidence.version,version);
await saveEvidence('rep2',input('rep2'));
const assessmentInput={reviewed:10,correct:9,review_note:'Synthetic reviewed sample',conduct:Object.fromEntries(conductKeys.map(key=>[key,{score:80,note:'Synthetic management review'}]))};
for(const memberId of ['rep','rep2','sup','manager'])await responseJson(await assessmentApi.POST(jsonRequest('/api/kpis',{memberId,month,version:0,requestId:crypto.randomUUID(),input:assessmentInput})),200);
data=await read();
for(const [id,numerator,denominator,score] of [['collection',10000,20000,50],['recovered',1,2,50],['retention',1,2,50],['orders',1,2,50]]){
 const m=metric(data,id);eq([m.numerator,m.denominator,m.score,m.status],[numerator,denominator,score,'scored'],'Real combined KPI metric '+id);
}
eq(person(data).attainment.rows[1].actual,0,'A confirmed complete import establishes zero for an absent product');
eq(person(data).attainment.rows[2].target,0);eq(person(data).attainment.rows[2].contribution,0);
eq(person(data).attainment.applicableWeight,80,'A zero product target excludes its 20% product weight');
eq(person(data).attainment.score,62.5,'The remaining positive-target products are normalized to their 80% weight');
for(const id of ['positive','quotes','documentation'])eq(metric(data,id).status,'not_applicable','No observed cohort is N/A for '+id);
eq(metric(data,'quality').score,90);eq(metric(data,'responsibility').score,80);
eq(person(data).summary.covered,100,'Every weighted indicator is scored or legitimately N/A');
eq(person(data).summary.complete,true);ok(Number.isFinite(person(data).summary.total),'Complete KPI returns a usable final score');
eq(person(data,'rep2').summary.covered,100);eq(person(data,'rep2').summary.complete,true);
for(const id of ['other','west'])eq(data.kpis.people.some(row=>row.member.id===id),false,'Supervisor cannot see '+id);
eq(data.sales.some(row=>['other','west'].includes(row.repId)),false,'Supervisor sales retain team and regional boundaries');
for(const [id,numerator,denominator,score] of [['collection',20000,30000,66.67],['recovered',2,3,66.67],['retention',1,2,50],['orders',2,3,66.67]]){
 const m=metric(data,id,'sup');eq([m.numerator,m.denominator,m.score],[numerator,denominator,score],'Supervisor aggregates actual evidence for '+id);
}
const managed=await read('manager');eq(person(managed,'manager').salesSourceMemberIds.slice().sort(),['rep','rep2']);
for(const id of ['collection','recovered','retention','orders'])eq(metric(managed,id,'manager').score,metric(data,id,'sup').score,'Manager and supervisor share the same scoped sales team '+id);
eq(managed.kpis.people.some(row=>row.member.id==='west'),false,'Manager never receives the western-region representative');
await read('rep',403);await read(null,401);

// An import revision change makes completeness attestations stale. Money is
// still known because collection is a separate reviewed ledger input.
sql.prepare("UPDATE crm_erp_import_state SET revision=revision+1 WHERE id='yourrest-industries'").run();
data=await read();eq(metric(data,'collection').score,50);
for(const id of ['recovered','retention','orders'])eq(metric(data,id).status,'missing','Changed sales snapshot invalidates '+id);
eq(person(data).attainment.rows[1].actual,null);eq(person(data).summary.complete,false);
globalThis.testIdentity='admin';await saveEvidence('rep',input());await saveEvidence('rep2',input('rep2'));
eq(person(await read()).summary.complete,true,'Re-review after the import restores the complete assessment');

// Existing links are revalidated from current documents; an issued quote that
// becomes a draft no longer establishes a completed conversion cohort.
sql.prepare("UPDATE crm_records SET data=json_set(data,'$.status','draft'),version=version+1 WHERE id='quote-erp'").run();
data=await read();eq(metric(data,'orders').status,'missing','A changed quote cannot preserve an old conversion score');eq(metric(data,'retention').status,'missing','A changed quote revision conservatively requires completeness review');eq(metric(data,'collection').score,50,'Independent collection remains available after quote changes');
sql.prepare("UPDATE crm_records SET data=json_set(data,'$.status','sent'),version=version+1 WHERE id='quote-erp'").run();
eq(metric(await read(),'orders').status,'missing','Restoring the quote still requires confirming the latest snapshot');
globalThis.testIdentity='admin';await saveEvidence('rep',input());await saveEvidence('rep2',input('rep2'));
eq(metric(await read(),'orders').score,50,'Reconfirmed restored quote counts again');
// Use the real sales API to void the linked manual invoice. The database trigger
// must invalidate the history snapshot and the removed sale must stop counting.
globalThis.testIdentity='admin';await responseJson(await salesApi.POST(jsonRequest('/api/sales',{action:'void',id:'rep2-recovered-current',version:1,reason:'Synthetic reversal check'})),200);
data=await read();eq(metric(data,'orders','rep2').status,'missing');eq(metric(data,'collection','rep2').score,100);
globalThis.testIdentity='admin';const afterVoid=input('rep2');afterVoid.quotations=[{quoteId:'quote-manual',saleId:null}];
await saveEvidence('rep',input());await saveEvidence('rep2',afterVoid);
data=await read();eq(metric(data,'orders','rep2').score,0,'Explicitly unconverted quote is a real zero');eq(metric(data,'recovered','rep2').numerator,0,'Voided sale cannot recover a former customer');
eq(metric(data,'orders','sup').score,33.33);eq(metric(data,'recovered','sup').numerator,1);
eq(sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');eq(sql.prepare('PRAGMA foreign_key_check').all(),[]);sql.close();
console.log(JSON.stringify({ok:true,checks,scope:'Persisted KPI evidence and management assessment through real sales API: complete weighted score, manual/ERP buyer identity, signed returns, zero targets, missing values, hierarchical regional rollups, replay, import invalidation and changed/voided conversions'}));
