import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
// Real migrations, SQL transactions and authenticated target endpoints. No production writes.
const root=process.cwd(),runtime=path.join(root,'.sites-runtime');fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'target-carry-forward-')),seen=new Set();process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const id=globalThis.testIdentity;if(!id)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version,email FROM crm_members WHERE id=?').bind(id).first();return {memberId:m?.id,memberVersion:m?.auth_version,email:m?.email};}`);
function compile(relative){if(seen.has(relative))return;seen.add(relative);const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;let rel=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));if(!/\.tsx?$/.test(rel))rel+=fs.existsSync(path.join(root,rel+'.ts'))?'.ts':'.tsx';compile(rel);return 'from '+JSON.stringify(path.join(out,rel.replace(/\.tsx?$/,'.mjs')));});fs.writeFileSync(dest,code);}
compile('app/api/targets/route.ts');compile('lib/targets-server.ts');
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+f,'utf8'));
let race=null,auditFailure=false;
class Statement{constructor(q,a=[]){this.q=q;this.a=a;}bind(...a){return new Statement(this.q,a);}async run(){if(auditFailure&&this.q.startsWith('INSERT INTO crm_audit'))throw Error('simulated audit failure');const result=sql.prepare(this.q).run(...this.a);return {meta:{changes:Number(result.changes)}};}async all(){return {results:sql.prepare(this.q).all(...this.a)};}async first(){return sql.prepare(this.q).get(...this.a)||null;}}
const DB={prepare:q=>new Statement(q),batch:async statements=>{if(race){const fn=race;race=null;await fn();}sql.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid',YR_AUTH_SECRET:'a'.repeat(64)};
const member=(id,role='rep',region='eastern',supervisor='sup',active=1)=>sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,?,0,?)').run(id,'u-'+id,id+'@yourrest.org',id,role,'HQ',supervisor,region,active,'2026-01-01');
member('admin','admin','all','');member('manager','manager','eastern','');member('sup','supervisor','eastern','manager');member('rep');member('rep2');member('empty','rep','eastern','unassigned');member('west','rep','western','sup');member('inactive','rep','eastern','sup',0);member('service','customer_service');
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-admin')").run();
const api=await import(path.join(out,'app/api/targets/route.mjs')),server=await import(path.join(out,'lib/targets-server.mjs')),domain=await import(path.join(out,'lib/crm-server.mjs')),pure=await import(path.join(out,'lib/targets.mjs'));
let checks=0;const check=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};const user=id=>{globalThis.testIdentity=id;};
const quantities=n=>({products:pure.targetProducts.map(p=>({product:p.id,quantity:n}))});
const req=body=>new Request('https://test.invalid/api/targets',{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json'},body:JSON.stringify(body)});
async function post(body,status=200){const response=await api.POST(req(body)),data=await response.json();assert.equal(response.status,status,JSON.stringify(data));checks++;return data;}
async function state(month){return server.targetState(await domain.context(),month);}
function effective(s,id='rep',kind='sales'){return pure.effectiveSet(s,kind,id);}
async function input(month,n,id='rep',kind='sales'){return {...pure.targetSaveBase(await state(month),kind,id),requestId:crypto.randomUUID(),data:kind==='sales'?quantities(n):n};}
function row(id,month,kind='sales'){return sql.prepare('SELECT * FROM crm_target_sets WHERE scope_id=? AND month=? AND kind=?').get(id,month,kind);}
function fixture(id,month,n,kind='sales'){sql.prepare('INSERT INTO crm_target_sets(kind,scope_id,month,data,version,mutation_id,updated_by,updated_at) VALUES(?,?,?,?,1,\'fixture\',\'admin\',\'2026-01-01\')').run(kind,id,month,JSON.stringify(kind==='sales'?quantities(n):n));}
user('admin');let s=await state('2026-01');check(effective(s),undefined);check(pure.targetSaveBase(s,'sales','rep'),{kind:'sales',scopeId:'rep',month:'2026-01',version:0,inheritedFrom:null});
let body=await input('2026-01',100);await post(body);const january=JSON.stringify(row('rep','2026-01'));
s=await state('2026-02');check(effective(s).month,'2026-01');check(effective(s).data.products[0].quantity,100);check(pure.targetSaveBase(s,'sales','rep'),{kind:'sales',scopeId:'rep',month:'2026-02',version:0,inheritedFrom:{month:'2026-01',version:1}});check(row('rep','2026-02'),undefined,'reading does not insert monthly copies');
// A selected-month edit creates an override; previous months remain untouched.
body=await input('2026-03',200);await post(body);check(JSON.stringify(row('rep','2026-01')),january);check(effective(await state('2026-02')).data.products[0].quantity,100);check(effective(await state('2026-03')).data.products[0].quantity,200);check(effective(await state('2026-04')).month,'2026-03');check(effective(await state('2025-12')),undefined);
// Current-month edits use their own version and preserve idempotent retries.
body=await input('2026-03',250);check(body.version,1);check(body.inheritedFrom,null);await post(body);await post(body);check(row('rep','2026-03').version,2);check(JSON.parse(row('rep','2026-03').data).products[0].quantity,250);await post({...body,data:quantities(251)},409);await post({...body,requestId:crypto.randomUUID()},409);
// Explicit zero and null are real overrides and do not fall back to old nonzero amounts.
body=await input('2026-04',120);body.data.products[0].quantity=0;body.data.products[1].quantity=null;await post(body);s=await state('2026-05');check(effective(s).month,'2026-04');check(effective(s).data.products[0].quantity,0);check(effective(s).data.products[1].quantity,null);check(effective(s).data.products[2].quantity,120);
const april=JSON.stringify(row('rep','2026-04'));body=await input('2026-05',300);await post(body);check(JSON.stringify(row('rep','2026-04')),april);check(effective(await state('2026-06')).data.products[0].quantity,300);check(effective(await state('2026-04')).data.products[0].quantity,0);
// Existing future changes take effect only when their month arrives.
fixture('rep','2026-09',900);check(effective(await state('2026-08')).month,'2026-05');check(effective(await state('2026-09')).month,'2026-09');check(effective(await state('2027-01')).data.products[0].quantity,900);check(effective(await state('2026-09'),'empty'),undefined);
// Forged or omitted inheritance cannot bypass source checks.
body=await input('2026-07',700);await post({...body,inheritedFrom:null},409);await post({...body,inheritedFrom:{month:'2026-01',version:1}},409);await post({...body,inheritedFrom:{month:'2026-05',version:999}},409);await post({...body,inheritedFrom:{month:'2026-07',version:1}},400);await post({...body,version:1},400);
// A changed inherited row or newly inserted intervening row aborts the whole batch.
body=await input('2026-07',700);let audits=sql.prepare('SELECT count(*) AS n FROM crm_audit').get().n;race=()=>sql.prepare("UPDATE crm_target_sets SET version=version+1 WHERE scope_id='rep' AND month='2026-05' AND kind='sales'").run();await post(body,409);check(row('rep','2026-07'),undefined);check(sql.prepare('SELECT count(*) AS n FROM crm_audit').get().n,audits);
body=await input('2026-07',700);race=()=>fixture('rep','2026-06',600);await post(body,409);check(row('rep','2026-07'),undefined);check(effective(await state('2026-07')).month,'2026-06');
// Two new writes in the selected month cannot overwrite each other.
body=await input('2026-07',700);race=()=>fixture('rep','2026-07',701);await post(body,409);check(JSON.parse(row('rep','2026-07').data).products[0].quantity,701);
// A first target appearing after an empty-source read cannot be missed.
body=await input('2026-03',30,'empty');race=()=>fixture('empty','2026-02',20);await post(body,409);check(row('empty','2026-03'),undefined);check(effective(await state('2026-03'),'empty').data.products[0].quantity,20);
// Source deletion and audit failure both preserve the old committed history.
body=await input('2026-10',1000);race=()=>sql.prepare("DELETE FROM crm_target_sets WHERE scope_id='rep' AND month='2026-09' AND kind='sales'").run();await post(body,409);check(row('rep','2026-10'),undefined);fixture('rep','2026-09',900);
body=await input('2026-10',1000);auditFailure=true;const logger=console.error;console.error=()=>{};await post(body,500);console.error=logger;auditFailure=false;check(row('rep','2026-10'),undefined);check(JSON.parse(row('rep','2026-09').data).products[0].quantity,900);await post(body);check(effective(await state('2026-11')).data.products[0].quantity,1000);
// Activity/weights retain the same carry-forward behavior and validation.
await post(await input('2026-01',{newCustomers:3,recoveredCustomers:4,visits:99},'rep','activity'));const weights={products:pure.targetProducts.map((p,i)=>({product:p.id,weight:i?0:100}))};await post(await input('2026-01',weights,'company','weights'));s=await state('2026-08');check(effective(s,'rep','activity').data.visits,99);check(effective(s,'company','weights').month,'2026-01');
// Team totals use each active rep's applicable source month, not copied monthly rows.
fixture('rep2','2026-01',80);fixture('inactive','2026-01',500);fixture('west','2026-01',999);user('manager');s=await state('2026-02');check(effective(s,'sup').data.products[0].quantity,180);check(effective(s,'manager').data.products[0].quantity,180);check(effective(s,'sup').teamMemberIds.sort(),['rep','rep2']);check(effective(s,'west'),undefined);
fixture('inactive','2026-03',500);s=await state('2026-03');check(effective(s,'sup').data.products[0].quantity,830);check(effective(s,'sup').teamMemberIds.includes('inactive'),true);s=await state('2026-04');check(effective(s,'sup').teamMemberIds.includes('inactive'),false);check(effective(s,'sup').data.products[0].quantity,80);check(effective(s,'sup').data.products[1].quantity,null);
// Unknown targets in an active team remain unknown instead of becoming zero.
member('unknown-team');s=await state('2026-04');check(effective(s,'sup').data.products[0].quantity,null);check(effective(s,'manager').data.products[0].quantity,null);sql.prepare("UPDATE crm_members SET supervisor_id='unassigned' WHERE id='unknown-team'").run();
// ERP quantities and returns are still evaluated only for the selected month.
s=await state('2026-02');const exampleSale={id:'test',repId:'rep',status:'confirmed',date:'2026-02-01',items:[{product:pure.targetProducts[0].id,quantity:40}]};const attained=pure.quantityAttainment('rep',s,[exampleSale,{...exampleSale,id:'return',items:[{product:pure.targetProducts[0].id,quantity:-10}]},{...exampleSale,date:'2026-01-01',items:[{product:pure.targetProducts[0].id,quantity:999}]}]);check(attained.rows[0].target,100);check(attained.rows[0].actual,30);check(attained.rows[0].achievement,30);
// Role, region and commit-time access remain unchanged.
await post(await input('2026-12',10,'west'),403);await post(await input('2026-12',10,'sup'),400);await post(await input('2026-12',10,'manager'),400);await post({...await input('2026-12',weights,'company','weights')},403);
body=await input('2026-12',1200);race=()=>sql.prepare("UPDATE crm_members SET region_scope='western' WHERE id='manager'").run();await post(body,409);check(row('rep','2026-12'),undefined);sql.prepare("UPDATE crm_members SET region_scope='eastern' WHERE id='manager'").run();
body=await input('2026-12',1200);race=()=>sql.prepare("UPDATE crm_members SET role='rep' WHERE id='manager'").run();await post(body,409);check(row('rep','2026-12'),undefined);sql.prepare("UPDATE crm_members SET role='manager' WHERE id='manager'").run();
body=await input('2026-12',1200);race=()=>sql.prepare("UPDATE crm_members SET region_scope='western' WHERE id='rep'").run();await post(body,409);check(row('rep','2026-12'),undefined);sql.prepare("UPDATE crm_members SET region_scope='eastern' WHERE id='rep'").run();
body=await input('2026-12',1200);race=()=>sql.prepare("UPDATE crm_members SET supervisor_id='different-team' WHERE id='rep'").run();await post(body,409);check(row('rep','2026-12'),undefined);sql.prepare("UPDATE crm_members SET supervisor_id='sup' WHERE id='rep'").run();
for(const actor of ['rep','sup','service']){user(actor);await post(body,403);}user(null);await post(body,401);user('admin');check(JSON.stringify(row('rep','2026-01')),january);check(sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
console.log(JSON.stringify({ok:true,checks,scope:'Real SQLite carry-forward targets: history, monthly overrides, zero/null, inheritance conflicts, team/region/role guards, ERP quantities and idempotence'}));
