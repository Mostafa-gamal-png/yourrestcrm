import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';

// Real migrations and route handlers with an isolated identity provider and in-memory SQLite.
const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'own-targets-')),seen=new Set();
process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){return globalThis.testUser;}`);
function compile(relative){
 if(seen.has(relative))return;seen.add(relative);
 const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));
 fs.mkdirSync(path.dirname(dest),{recursive:true});
 let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
  if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));
  if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));
  if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
  let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
  if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';
  compile(source);return 'from '+JSON.stringify(path.join(out,source.replace(/\.tsx?$/,'.mjs')));
 });
 fs.writeFileSync(dest,code);
}
for(const name of ['targets','sales','kpis'])compile('app/api/'+name+'/route.ts');
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const file of fs.readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+file,'utf8'));
let beforeGuard=null;
const targetQueries=[],quantityQueries=[];
class Statement{
 constructor(q,a=[]){this.q=q;this.a=a;}
 bind(...a){return new Statement(this.q,a);}
 async run(){const result=sql.prepare(this.q).run(...this.a);return{meta:{changes:Number(result.changes)}};}
 async all(){if(this.q.startsWith('SELECT kind,month,data FROM crm_target_sets'))targetQueries.push({q:this.q,a:this.a});if(this.q.includes('json_each(s.data')||this.q.includes('FROM crm_erp_sales WHERE rep_id='))quantityQueries.push({q:this.q,a:this.a});return{results:sql.prepare(this.q).all(...this.a)};}
 async first(){if(beforeGuard&&this.q.startsWith('SELECT 1 AS allowed')){const f=beforeGuard;beforeGuard=null;f();}return sql.prepare(this.q).get(...this.a)||null;}
}
const DB={prepare:q=>new Statement(q),batch:async statements=>{sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid'};
const now=new Date().toISOString();
function member(id,role='rep',region='eastern'){
 sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,'u-'+id,id+'@yourrest.org',id==='rep'?'المندوب الحالي':'private-member-'+id,role,'private-branch-'+id,region,1,99999999,now);
}
member('owner','admin','all');member('rep');member('other');member('western','rep','western');member('sup','supervisor');member('manager','manager');member('cs','customer_service');member('csm','customer_service_manager');
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-owner')").run();
const user=id=>{globalThis.testUser=id?{userId:'u-'+id,email:id+'@yourrest.org',memberId:id,memberVersion:sql.prepare('SELECT auth_version FROM crm_members WHERE id=?').get(id)?.auth_version,provider:'email-otp'}:null;};
const targets=await import(path.join(out,'app/api/targets/route.mjs')),sales=await import(path.join(out,'app/api/sales/route.mjs')),kpis=await import(path.join(out,'app/api/kpis/route.mjs'));
const {salesProducts}=await import(path.join(out,'lib/sales.mjs'));
const {emptyKpiInput}=await import(path.join(out,'lib/kpis.mjs'));
const products=quantity=>salesProducts.map(product=>({product,quantity}));
function set(kind,scopeId,month,data){sql.prepare('INSERT INTO crm_target_sets(kind,scope_id,month,data,version,mutation_id,updated_by,updated_at) VALUES(?,?,?,?,1,?,?,?)').run(kind,scopeId,month,JSON.stringify(data),'private-mutation-'+scopeId,'owner',now);}
set('sales','rep','2026-09',{products:products(7).map((p,i)=>({...p,quantity:i===0?0:i===1?null:i===2?1.125:p.quantity})),privateMarker:'own-nonpublic-field'});
set('sales','rep','2026-08',{products:products(8)});
set('sales','rep','2026-11',{products:products(11)});
set('activity','rep','2026-07',{newCustomers:4,recoveredCustomers:3,visits:101,privateMarker:'own-nonpublic-activity'});
set('activity','rep','2026-09',{newCustomers:6,recoveredCustomers:2,visits:120});
set('activity','rep','2026-11',{newCustomers:9,recoveredCustomers:8,visits:190});
for(const id of ['other','western','sup','manager','branch:private-branch-rep']){
 set('sales',id,'2026-09',{products:products(7777777),privateMarker:'private-foreign-'+id});
 set('activity',id,'2026-09',{newCustomers:888888,recoveredCustomers:888888,visits:888888});
}
set('weights','company','2026-09',{products:salesProducts.map(product=>({product,weight:99999})),privateMarker:'private-company-weights'});
sql.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES('factory','customer',NULL,'rep','private-branch-rep',?,?,?,1,'fixture')").run(JSON.stringify({name:'private-factory',region:'الشرقية'}),now,now);
const saleData={customerId:'factory',repId:'rep',date:'2026-09-15',reference:'PRIVATE-INVOICE',items:[{product:salesProducts[0],description:'private-invoice-item',quantity:1,unitPrice:918273}],discount:0,notes:'private-invoice-note'};
sql.prepare("INSERT INTO crm_sales(id,customer_id,rep_id,branch,date,reference,reference_key,data,total_cents,status,void_reason,version,mutation_id,create_fingerprint,created_by,created_at,updated_at) VALUES('sale','factory','rep','private-branch-rep','2026-09-15','PRIVATE-INVOICE','PRIVATE-INVOICE',?,91827300,'confirmed','',1,'fixture','fixture','owner',?,?)").run(JSON.stringify(saleData),now,now);
// Distinct manual identities, months, status and regions must never enter the own projection.
const factory=(id,region)=>sql.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,'customer',NULL,'rep','HQ',?,?,?,1,'fixture')").run(id,JSON.stringify({name:'private-'+id,region}),now,now);
factory('western-factory','الغربية');
const manual=(id,repId,customerId,date,status,quantity)=>sql.prepare("INSERT INTO crm_sales(id,customer_id,rep_id,branch,date,reference,reference_key,data,total_cents,status,void_reason,version,mutation_id,create_fingerprint,created_by,created_at,updated_at) VALUES(?,?,?,'HQ',?,?,?, ?,91827300,?,'',1,'fixture','fixture','owner',?,?)").run(id,customerId,repId,date,id,id,JSON.stringify({...saleData,items:[{product:salesProducts[2],quantity,unitPrice:918273}]}),status,now,now);
manual('own-good','rep','factory','2026-09-16','confirmed',2.5);
manual('other-hidden','other','factory','2026-09-16','confirmed',9999);
manual('own-void','rep','factory','2026-09-16','void',9999);
manual('own-wrong-region','rep','western-factory','2026-09-16','confirmed',9999);
manual('own-other-month','rep','factory','2026-08-16','confirmed',9999);
sql.prepare("INSERT INTO crm_erp_imports(id,actor_id,fingerprint,file_name,result,created_at) VALUES('own-fixture','owner','fixture','private-report.xlsx','{}',?)").run(now);
const erp=(id,repId,region,date,product,quantity)=>sql.prepare("INSERT INTO crm_erp_sales(id,document_key,content_hash,mapped_hash,reference,document_type,date,employee_id,rep_id,branch,region_scope,customer_code,customer_name,data,total_cents,import_id,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,'HQ',?,'private-code','private-customer',?,91827300,'own-fixture','owner',?)").run(id,id,'fixture','fixture','PRIVATE-'+id,quantity<0?'return':'sale',date,'private-employee',repId,region,JSON.stringify({items:[{product,quantity,unitPrice:918273,description:'private-line'}]}),now);
erp('erp-own','rep','eastern','2026-09-21',salesProducts[2],1.75);
erp('erp-own-return','rep','eastern','2026-09-22',salesProducts[2],-0.5);
erp('erp-own-negative','rep','eastern','2026-09-22',salesProducts[3],-2);
erp('erp-other','other','eastern','2026-09-21',salesProducts[2],9999);
erp('erp-other-region','rep','western','2026-09-21',salesProducts[2],9999);
erp('erp-other-month','rep','eastern','2026-08-21',salesProducts[2],9999);
let checks=0;
function eq(a,b,message){assert.deepEqual(a,b,message);checks++;}
function ok(value,message){assert.ok(value,message);checks++;}
async function get(query='?month=2026-09',status=200){
 const response=await targets.GET(new Request('https://test.invalid/api/targets'+query)),body=await response.json();
 eq(response.status,status);eq(response.headers.get('cache-control'),'private, no-store');return body;
}
const postRequest=body=>new Request('https://test.invalid/api/test',{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json'},body:JSON.stringify(body)});
async function post(api,body,status){const response=await api.POST(postRequest(body));eq(response.status,status);return response.json();}

user('rep');let payload=await get();
eq(payload.member,{id:'rep',name:'المندوب الحالي'});
eq(Object.keys(payload).sort(),['activity','member','month','sales']);
eq(Object.keys(payload.sales).sort(),['actualsAvailable','products','sourceMonth']);
eq(payload.sales.sourceMonth,'2026-09');eq(payload.sales.products.length,salesProducts.length);
eq(payload.sales.products.map(p=>p.quantity),products(7).map((p,i)=>i===0?0:i===1?null:i===2?1.125:p.quantity));
eq(payload.activity,{newCustomers:6,recoveredCustomers:2,visits:120,sourceMonth:'2026-09',isDefault:false});
eq(payload.sales.actualsAvailable,true);
eq(payload.sales.products[0],{product:salesProducts[0],quantity:0,actualQuantity:1,remainingQuantity:0,achievement:null});
eq(payload.sales.products[1],{product:salesProducts[1],quantity:null,actualQuantity:0,remainingQuantity:null,achievement:null});
eq(payload.sales.products[2],{product:salesProducts[2],quantity:1.125,actualQuantity:3.75,remainingQuantity:0,achievement:333.33});
eq(payload.sales.products[3],{product:salesProducts[3],quantity:7,actualQuantity:-2,remainingQuantity:9,achievement:-28.57});
eq(payload.sales.products[4],{product:salesProducts[4],quantity:7,actualQuantity:0,remainingQuantity:7,achievement:0});
eq(quantityQueries.length,2);
for(const query of quantityQueries){ok(query.q.includes('rep_id=?'),'quantities SQL restricts identity before reading');eq(query.a[0],'rep');eq(query.a[1],'2026-09-01');}

const encoded=JSON.stringify(payload);
for(const forbidden of ['private-','7777777','888888','99999','918273','PRIVATE-INVOICE','own-nonpublic','scopeId','teamMemberIds','weights','version','email','branches','updatedBy'])ok(!encoded.includes(forbidden),'response must not disclose '+forbidden);
ok(targetQueries.length===1&&targetQueries[0].q.includes('WHERE scope_id=?'));
eq(targetQueries[0].a,['rep','2026-09']);

// Both quantity and activity targets remain effective until the next explicit change; actuals stay monthly.
const targetsBeforeReads=sql.prepare('SELECT * FROM crm_target_sets ORDER BY kind,scope_id,month').all();
payload=await get('?month=2026-10');eq(payload.sales.sourceMonth,'2026-09');eq(payload.sales.products.map(p=>p.quantity),products(7).map((p,i)=>i===0?0:i===1?null:i===2?1.125:p.quantity));ok(payload.sales.products.every(p=>p.actualQuantity===0),'Carrying targets never carries last-month actual sales');eq(payload.sales.products[2].remainingQuantity,1.125);eq(payload.sales.products[2].achievement,0);eq(payload.activity,{newCustomers:6,recoveredCustomers:2,visits:120,sourceMonth:'2026-09',isDefault:false});
payload=await get('?month=2026-08');eq(payload.sales.sourceMonth,'2026-08');ok(payload.sales.products.every(p=>p.quantity===8));eq(payload.activity,{newCustomers:4,recoveredCustomers:3,visits:101,sourceMonth:'2026-07',isDefault:false});
payload=await get('?month=2026-06');eq(payload.sales.sourceMonth,null);ok(payload.sales.products.every(p=>p.quantity===null));eq(payload.activity,{newCustomers:10,recoveredCustomers:5,visits:320,sourceMonth:null,isDefault:true});
const beforeFuture=quantityQueries.length;payload=await get('?month=2099-11');eq(payload.sales.actualsAvailable,false);ok(payload.sales.products.every(p=>p.actualQuantity===null&&p.remainingQuantity===null&&p.achievement===null));eq(quantityQueries.length,beforeFuture,'future months do not read actual sales');payload=await get('?month=2026-11');eq(payload.sales.sourceMonth,'2026-11');ok(payload.sales.products.every(p=>p.quantity===11));eq(payload.activity.sourceMonth,'2026-11');
payload=await get('?month=2026-12');eq(payload.sales.sourceMonth,'2026-11');ok(payload.sales.products.every(p=>p.quantity===11),'Latest change persists past its month');
payload=await get('?month=2026-09');eq(payload.sales.products[2].quantity,1.125,'Later targets never alter historical month');
eq(sql.prepare('SELECT * FROM crm_target_sets ORDER BY kind,scope_id,month').all(),targetsBeforeReads,'Carry-forward reads create no monthly copies');
payload=await get('');eq(payload.month,new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).slice(0,7));
for(const query of ['?month=','?month=2026-13','?month=2026-1','?month=2026-09&month=2026-08','?month=2026-09&memberId=other','?scopeId=western','?repId=other','?kind=weights','?branch=private-branch-rep','?month=2026-09%27%20OR%201%3D1--'])await get(query,400);

// Other active roles retain their existing management screen. This endpoint grants no new role access.
for(const id of ['owner','sup','manager','cs','csm']){user(id);await get('?month=2026-09',403);}
user(null);await get('?month=2026-09',401);
user('rep');sql.prepare("UPDATE crm_members SET active=0 WHERE id='rep'").run();await get('?month=2026-09',403);sql.prepare("UPDATE crm_members SET active=1 WHERE id='rep'").run();
globalThis.testUser.memberVersion=999;await get('?month=2026-09',403);user('rep');
beforeGuard=()=>sql.prepare("UPDATE crm_members SET active=0 WHERE id='rep'").run();await get('?month=2026-09',403);eq(beforeGuard,null);sql.prepare("UPDATE crm_members SET active=1 WHERE id='rep'").run();
user('rep');beforeGuard=()=>sql.prepare("UPDATE crm_members SET role='customer_service' WHERE id='rep'").run();await get('?month=2026-09',403);eq(beforeGuard,null);sql.prepare("UPDATE crm_members SET role='rep' WHERE id='rep'").run();
user('rep');beforeGuard=()=>sql.prepare("UPDATE crm_members SET region_scope='western' WHERE id='rep'").run();await get('?month=2026-09',403);eq(beforeGuard,null);sql.prepare("UPDATE crm_members SET region_scope='eastern' WHERE id='rep'").run();

// A Western rep with no own rows sees defaults, regardless of other branch/team/company targets.
member('empty','rep','western');user('empty');payload=await get();eq(payload.member.id,'empty');eq(payload.sales.sourceMonth,null);ok(payload.sales.products.every(p=>p.quantity===null));eq(payload.activity.isDefault,true);
user('other');payload=await get();eq(payload.member.id,'other');ok(payload.sales.products.every(p=>p.quantity===7777777));ok(!JSON.stringify(payload).includes('المندوب الحالي'));

// Display access is read only: targets, sales and KPI write gates remain unchanged.
user('rep');const before=sql.prepare('SELECT * FROM crm_target_sets ORDER BY kind,scope_id,month').all();
for(const kind of ['sales','activity','weights'])await post(targets,{kind,scopeId:'rep',month:'2026-09',version:1,inheritedFrom:null,requestId:crypto.randomUUID(),data:kind==='sales'?{products:products(999)}:kind==='activity'?{newCustomers:999,recoveredCustomers:999,visits:999}:{products:salesProducts.map((product,i)=>({product,weight:i?0:100}))}},403);
eq(sql.prepare('SELECT * FROM crm_target_sets ORDER BY kind,scope_id,month').all(),before);
for(const query of ['?month=2026-09','?month=2026-09&kpis=1'])eq((await sales.GET(new Request('https://test.invalid/api/sales'+query))).status,403);
await post(sales,{action:'save',version:0,createKey:crypto.randomUUID(),data:saleData},403);
await post(kpis,{memberId:'rep',month:'2026-09',version:0,requestId:crypto.randomUUID(),input:emptyKpiInput()},403);
sql.close();
console.log(JSON.stringify({ok:true,checks,note:'Own monthly quantity attainment: real SQLite route, signed ERP returns, manual scopes, zero/missing targets, privacy, future months, revocation and unchanged management write gates.'}));
