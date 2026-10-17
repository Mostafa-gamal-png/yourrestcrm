import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
// Isolated handler integration checks: real SQL migrations and domain code; mocked identity and R2.
// No network requests or production writes. Run from the repository root.
const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'quote-total-limits-')),seen=new Set();
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
const {schemas}=await import(path.join(out,'lib/crm.mjs'));
const body=(price,quantity=1,taxRate=0,discount=0)=>({date:day,validUntil:day,status:'draft',items:[{description:'Test item',quantity,price}],taxRate,discount});
assert.equal(schemas.quote.safeParse(body(1000000000,1000000)).success,false,'Computed subtotal cannot bypass the existing amount limit');checks++;
assert.equal(schemas.quote.safeParse(body(1000000000,1,15)).success,false,'Computed VAT-inclusive total must respect its existing limit');checks++;
assert.equal(schemas.quote.safeParse(body(1000000000,1,0)).success,true,'Existing upper boundary remains accepted');checks++;
assert.equal(schemas.quote.safeParse(body(1000000000,1,15,1000000000)).success,true,'Discount at full subtotal preserves existing zero-total policy');checks++;
const machine=await post(crm,{action:'save',kind:'factory',createKey:crypto.randomUUID(),parentId:'factory',data:{name:'Test machine',machineBrand:'Test',machineModel:'T1',machineType:'mobile'}});
const request=await post(crm,{action:'save',kind:'opportunity',createKey:crypto.randomUUID(),parentId:machine.id,data:{moldType:'Test mold',product:'Block',dimensions:'test',quantity:1,value:100,stage:'specs',nextAction:'Review',nextDate:day,technicalStatus:'approved',technicalNotes:'Approved for test'}});
const quoteInput=data=>({action:'save',kind:'quote',createKey:crypto.randomUUID(),parentId:request.id,data});
const quotes=()=>sql.prepare("SELECT COUNT(*) n FROM crm_records WHERE kind='quote'").get().n;
const before=quotes(),auditBefore=sql.prepare('SELECT COUNT(*) n FROM crm_audit').get().n;
await post(crm,quoteInput(body(1000000000,1000000)),400);
await post(crm,quoteInput(body(1000000000,1,15)),400);
await post(crm,quoteInput(body(1000000000,1000000,15,1000000000)),400);
assert.equal(quotes(),before);assert.equal(sql.prepare('SELECT COUNT(*) n FROM crm_audit').get().n,auditBefore);checks+=2;
const valid=quoteInput(body(100,2,15,10)),saved=await post(crm,valid);
assert.equal(row(saved.id).data.total,218.5);assert.equal((await post(crm,valid)).id,saved.id);checks+=2;
await post(crm,{...valid,id:saved.id,version:1,data:body(1000000000,1000000)},400);
assert.equal(raw(saved.id).version,1);assert.equal(row(saved.id).data.total,218.5);checks+=2;
const maximum=await post(crm,quoteInput(body(1000000000)));
assert.equal(row(maximum.id).data.total,1000000000);checks++;
// The year in a new quote number follows Asia/Riyadh, not the zone of the server clock: 22:30 UTC on 31 December is already 2027 there.
const RealDate=Date,newYearEve=RealDate.UTC(2026,11,31,22,30);
globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[newYearEve]));}static now(){return newYearEve;}};
try{const newYear=await post(crm,quoteInput(body(100)));assert.match(row(newYear.id).data.number,/^YR-2027-[0-9A-F]{8}$/);checks++;}finally{globalThis.Date=RealDate;}
assert.equal(sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');checks++;
console.log(JSON.stringify({ok:true,checks,scope:'Actual quote schema and authenticated SQLite API; computed caps, VAT, discounts, no partial writes, editing and replay'}));
