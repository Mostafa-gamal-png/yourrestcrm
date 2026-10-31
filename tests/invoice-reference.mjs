import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
// Isolated handler integration checks: real SQL migrations and domain code; mocked identity and R2.
// No network requests or production writes. Run from the repository root.
const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'invoice-reference-')),seen=new Set();
process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const u=globalThis.testUser;if(!u)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version FROM crm_members WHERE user_id=? OR email=?').bind(u.userId,u.email).first();return {...u,provider:'email-otp',memberId:m?.id||'missing',memberVersion:m?.auth_version};}`);
function compile(relative){if(seen.has(relative))return;seen.add(relative);const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;let destSource=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));if(!/\.tsx?$/.test(destSource))destSource+=fs.existsSync(path.join(root,destSource+'.ts'))?'.ts':'.tsx';compile(destSource);return 'from '+JSON.stringify(path.join(out,destSource.replace(/\.tsx?$/,'.mjs')));});fs.writeFileSync(dest,code);}
for(const r of ['crm','customer-service','visits','customer-followups','followups','sales','targets','kpis','visit-files'])compile('app/api/'+r+'/route.ts');
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+f,'utf8'));
let race=null,auditFailure=false;
class Statement{constructor(q,a=[]){this.q=q;this.a=a;}bind(...a){return new Statement(this.q,a);}async run(){if(auditFailure&&this.q.startsWith('INSERT INTO crm_audit'))throw new Error('test-audit-failure');const r=sql.prepare(this.q).run(...this.a);return{meta:{changes:Number(r.changes)}};}async all(){return{results:sql.prepare(this.q).all(...this.a)};}async first(){return sql.prepare(this.q).get(...this.a)||null;}}
const DB={prepare:q=>new Statement(q),batch:async ss=>{if(race){const f=race;race=null;await f();}sql.exec('BEGIN');try{const results=[];for(const s of ss)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid'};
sql.prepare("INSERT INTO crm_members(id,user_id,email,name,role,branch,active,region_scope,target,created_at) VALUES('owner','u-owner','owner@yourrest.org','owner','admin','الرئيسي',1,'all',0,?)").run(new Date().toISOString());
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-owner')").run();const user=id=>{globalThis.testUser={userId:'u-'+id,email:id+'@yourrest.org',fullName:id};};user('owner');
const api=async name=>import(path.join(out,'app/api/'+name+'/route.mjs'));
const crm=await api('crm'),service=await api('customer-service'),followups=await api('customer-followups'),visits=await api('visits'),sales=await api('sales');
let checks=0;
const req=body=>new Request('https://test.invalid/api/test',{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json'},body:JSON.stringify(body)});
async function post(route,body,status=200){const res=await route.POST(req(body)),data=await res.json();assert.equal(res.status,status,JSON.stringify(data));checks++;return data;}
async function list(){const r=await service.GET(new Request('https://test.invalid/api/customer-service'));assert.equal(r.status,200);checks++;return r.json();}
await crm.GET();
const member=(id,role,supervisor='',region='eastern',branch='الرئيسي')=>sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,1,0,?)').run(id,'u-'+id,id+'@yourrest.org',id,role,branch,supervisor||null,region,new Date().toISOString());
member('sm','manager');member('other-sm','manager');member('sup','supervisor','sm');member('rep','rep','sup');member('rep2','rep','sm');member('outside','rep','other-sm');member('west','rep','sm','western');member('csm','customer_service_manager','sm');member('cs','customer_service','csm');member('cs2','customer_service','csm');member('other-csm','customer_service_manager','other-sm');member('csw','customer_service','other-csm','western');member('unrouted','customer_service');
const now=new Date().toISOString(),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function customer(id,region='الشرقية'){sql.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,\'customer\',NULL,\'outside\',\'الرئيسي\',?,?,?,1,\'fixture\')').run(id,JSON.stringify({name:id,phone:'0551111111',region,branch:'الرئيسي',assignedTo:'outside'}),now,now);}
customer('factory');customer('west-factory','الغربية');
sql.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(\'old-contact\',\'activity\',\'factory\',\'outside\',\'الرئيسي\',?,?,?,1,\'fixture\')').run(JSON.stringify({type:'visit',date:day,performedBy:'outside',summary:'private previous activity'}),now,now);
const raw=id=>sql.prepare('SELECT * FROM crm_records WHERE id=?').get(id),row=id=>({...raw(id),data:JSON.parse(raw(id).data)});

user('owner');
const input=(reference,extra={})=>({action:'save',createKey:crypto.randomUUID(),data:{customerId:'factory',repId:'rep',date:day,reference,items:[{product:'قوالب البلوك المتحركة',quantity:1,unitPrice:100}],discount:0,...extra}});
const count=()=>sql.prepare('SELECT COUNT(*) n FROM crm_sales').get().n;
const base=input('INV-123'),saved=await post(sales,base);
for(const reference of ['INV-\u200f123','ＩＮＶ-１２３','inv-123','INV-\u0661\u0662\u0663','inv-\u06f1\u06f2\u06f3'])await post(sales,input(reference),409);
assert.equal(count(),1);checks++;
assert.equal((await post(sales,base)).alreadySaved,true);checks++;
await post(sales,{...base,data:{...base.data,reference:'ＩＮＶ-１２３'}},409);
// The same row may normalize its own reference while optimistic editing/retry work.
await post(sales,{...base,id:saved.id,version:1,data:{...base.data,reference:'INV-\u200f123'}});
assert.equal(sql.prepare('SELECT reference_key FROM crm_sales WHERE id=?').get(saved.id).reference_key,'INV-123');checks++;
await post(sales,{...base,id:saved.id,version:1},409);
// Existing aliases remain untouched until explicitly edited; they still block duplicates.
function legacy(id,reference,customerId='factory'){
 const data=input(reference,{customerId}).data;
 sql.prepare("INSERT INTO crm_sales(id,customer_id,rep_id,branch,date,reference,reference_key,data,total_cents,status,void_reason,version,mutation_id,create_fingerprint,created_by,created_at,updated_at) VALUES(?,?,'rep','الرئيسي',?,?,?,?,10000,'confirmed','',1,'fixture',?,'owner',?,?)").run(id,customerId,day,reference,reference.toUpperCase(),JSON.stringify(data),JSON.stringify(data),now,now);
}
legacy('legacy','ＬＥＧＡＣＹ-７');await post(sales,input('LEGACY-7'),409);
// A row saved before Arabic digits were folded (2026-10-31) kept them in its key; its plain twin is still refused.
legacy('legacy-arabic','LEGACY-\u0668');await post(sales,input('LEGACY-8'),409);
assert.equal(sql.prepare("SELECT reference FROM crm_sales WHERE id='legacy'").get().reference,'ＬＥＧＡＣＹ-７');checks++;
await post(sales,{...input('legacy-7'),id:'legacy',version:1});
assert.equal(sql.prepare("SELECT reference_key FROM crm_sales WHERE id='legacy'").get().reference_key,'LEGACY-7');checks++;
// Historical idempotency fingerprints are preserved; request replay does not insert again.
legacy('sale-00000000-0000-4000-8000-000000000001','ＬＥＧＡＣＹ-ＲＥＰＬＡＹ');
const legacyReplay={...input('ＬＥＧＡＣＹ-ＲＥＰＬＡＹ'),createKey:'00000000-0000-4000-8000-000000000001'};
// Persist exactly the already-validated original body, as old production rows do.
const {saleSchema}=await import(path.join(out,'lib/sales.mjs'));
sql.prepare('UPDATE crm_sales SET create_fingerprint=? WHERE id=?').run(JSON.stringify(saleSchema.parse(legacyReplay.data)),'sale-'+legacyReplay.createKey);
assert.equal((await post(sales,legacyReplay)).alreadySaved,true);checks++;
// The original uniqueness boundary is per customer, not global/year-wide.
customer('other-factory');await post(sales,input('INV-123',{customerId:'other-factory'}));
await post(sales,input('INV / 10'));await post(sales,input(' INV  /  10 '),409);
await post(sales,input('INV-124'));
await post(sales,{...base,id:saved.id,version:2,data:{...base.data,reference:'ＩＮＶ-１２４'}},409);
await post(sales,input('\u200f\u200e'),400);
// A legacy writer racing the duplicate scan invalidates the transaction gate.
const beforeRace=count(),auditBefore=sql.prepare('SELECT COUNT(*) n FROM crm_audit').get().n;
race=()=>legacy('racing-legacy','ＲＡＣＥ-１');await post(sales,input('RACE-1'),409);
assert.equal(count(),beforeRace+1);assert.equal(sql.prepare('SELECT COUNT(*) n FROM crm_audit').get().n,auditBefore);checks+=2;
legacy('racing-update','TEMP-ALIAS');race=()=>sql.prepare("UPDATE crm_sales SET reference='ＲＡＣＥ-２',reference_key='ＲＡＣＥ-２',version=version+1 WHERE id='racing-update'").run();
await post(sales,input('RACE-2'),409);
const {erpInvoiceKey}=await import(path.join(out,'lib/erp-sales-server.mjs'));
assert.equal(await erpInvoiceKey('INV-123',day),await erpInvoiceKey('ＩＮＶ-\u200f１２３',day));checks++;
assert.equal(await erpInvoiceKey('INV-123',day),await erpInvoiceKey('inv-\u0661\u0662\u0663',day));checks++;
assert.equal(sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');checks++;
console.log(JSON.stringify({ok:true,checks,scope:'Actual authenticated sales route + real SQLite; canonical refs, legacy rows, optimistic edits, replays and races'}));
