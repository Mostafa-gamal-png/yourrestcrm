import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
// Authenticated route integration on an isolated real SQLite database; no production/network writes.
const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'customer-detail-edit-access-')),seen=new Set();
process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const u=globalThis.testUser;if(!u)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version FROM crm_members WHERE user_id=? OR email=?').bind(u.userId,u.email).first();return {...u,provider:'email-otp',memberId:m?.id||'missing',memberVersion:m?.auth_version};}`);
function compile(relative){if(seen.has(relative))return;seen.add(relative);const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';compile(source);return 'from '+JSON.stringify(path.join(out,source.replace(/\.tsx?$/,'.mjs')));});fs.writeFileSync(dest,code);}
for(const name of ['crm'])compile('app/api/'+name+'/route.ts');
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+f,'utf8'));
let race=null;
class Statement{constructor(q,a=[]){this.q=q;this.a=a;}bind(...a){return new Statement(this.q,a);}async run(){const r=sql.prepare(this.q).run(...this.a);return{meta:{changes:Number(r.changes)}};}async all(){return{results:sql.prepare(this.q).all(...this.a)};}async first(){return sql.prepare(this.q).get(...this.a)||null;}}
const DB={prepare:q=>new Statement(q),batch:async statements=>{if(race){const fn=race;race=null;await fn();}sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid'};
const now=new Date().toISOString(),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const member=(id,role,region='eastern',branch='الرئيسي')=>sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,1,0,?)').run(id,'u-'+id,id+'@yourrest.org',id,role,branch,region,now);
member('owner','admin','all');member('rep','rep');member('peer','rep');member('west','rep','western');member('all-rep','rep','all');member('unassigned-rep','rep','unassigned');member('cs','customer_service');
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-owner')").run();
const user=id=>{globalThis.testUser=id?{userId:'u-'+id,email:id+'@yourrest.org',fullName:id}:null;};
const crm=await import(path.join(out,'app/api/crm/route.mjs'));
const raw=id=>sql.prepare('SELECT * FROM crm_records WHERE id=?').get(id),row=id=>({...raw(id),data:JSON.parse(raw(id).data)});
let checks=0;
const check=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const request=(body,origin='https://test.invalid')=>new Request('https://test.invalid/api/crm',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
const post=async(body,status=200,route=crm,origin)=>{const res=await route.POST(request(body,origin)),data=await res.json();check(res.status,status,JSON.stringify(data));return data;};
const read=async()=>{const res=await crm.GET();check(res.status,200);return res.json();};
const create=(data={},extra={})=>({action:'save',kind:'customer',createKey:crypto.randomUUID(),data:{name:'مصنع اختبار الإضافة',region:'الشرقية',location:'26.437341, 50.034499',...data},...extra});

member('manager','manager');member('all-manager','manager','all');member('other-manager','manager');member('supervisor','supervisor');
sql.prepare("UPDATE crm_members SET supervisor_id='supervisor' WHERE id='peer'").run();
const customer=(id,assignedTo,region='الشرقية',branch='الرئيسي',extra={})=>{
 const data={name:'مصنع اختبار تعديل البيانات',region,branch,assignedTo,location:'26.437341, 50.034499',...extra};
 sql.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,'customer',NULL,?,?,?,?,?,1)").run(id,assignedTo,branch,JSON.stringify(data),now,now);
};
customer('admin-owned','owner');customer('manager-owned','other-manager');customer('peer-owned','peer');
customer('inactive-owned','peer');customer('outside-owned','west');customer('missing-owned','deleted-member');customer('unassigned-owned','');
customer('western-customer','west','الغربية');customer('foreign-branch','owner','الشرقية','فرع مستورد');
customer('legacy-fields','owner','الشرقية','الرئيسي',{assignedTo:undefined,branch:undefined});
const edit=(id,extra={},omitRouting=false)=>{
 const value=row(id),data={...value.data,assignedTo:value.assigned_to,branch:value.branch,...extra};
 if(omitRouting){delete data.assignedTo;delete data.branch;}
 return {action:'save',kind:'customer',id,version:value.version,data};
};
const snapshot=id=>sql.prepare('SELECT * FROM crm_records WHERE id=?').get(id);
const routing=id=>({assignedTo:row(id).assigned_to,branch:row(id).branch,region:row(id).data.region});

// Imported global administrators are intentionally absent from regional selectors.
// Correcting their customer's map or phone does not reassign that customer.
for(const actor of ['rep','manager']){
 user(actor);
 for(const id of ['admin-owned','manager-owned','outside-owned','missing-owned','unassigned-owned','foreign-branch','legacy-fields']){
  const before=routing(id);
  await post(edit(id,{phone:'0501234567',location:'26.44, 50.04'},id==='legacy-fields'));
  check(routing(id),before,actor+' preserves canonical routing for '+id);
  check(row(id).data.assignedTo,before.assignedTo);check(row(id).data.branch,before.branch);
  check(row(id).data.latitude,26.44);check(row(id).data.longitude,50.04);
  const visible=(await read()).records.find(r=>r.id===id);check(visible.data.phone,'0501234567');
  check(visible.data.latitude,26.44,'Map receives the corrected coordinate');
 }
}
sql.prepare("UPDATE crm_members SET active=0 WHERE id='peer'").run();
for(const actor of ['rep','manager']){user(actor);const before=routing('inactive-owned');await post(edit('inactive-owned',{contact:'تحديث جهة الاتصال'}));check(routing('inactive-owned'),before);}
sql.prepare("UPDATE crm_members SET active=1 WHERE id='peer'").run();

// Supervisor editing keeps the original direct-team limitation.
user('supervisor');await post(edit('peer-owned',{phone:'0501111111'}));
for(const id of ['admin-owned','manager-owned','outside-owned','missing-owned','unassigned-owned']){
 const before=snapshot(id);await post(edit(id,{phone:'0509999999'}),403);check(snapshot(id),before);
}

// Detail permission grants neither routing changes nor historical/deletion rights.
for(const actor of ['rep','manager']){
 user(actor);
 for(const extra of [{assignedTo:'peer'},{branch:'فرع آخر'},{assignedTo:'peer',_masterReadOnly:false,_masterRoutingReadOnly:false}]){
  const before=snapshot('admin-owned');await post(edit('admin-owned',extra),403);check(snapshot('admin-owned'),before);
 }
 await post(edit('admin-owned',{region:'الغربية'}),403);
 await post(edit('western-customer',{phone:'0502222222'}),404);
 await post({action:'delete',kind:'customer',id:'admin-owned',version:row('admin-owned').version},403);
}
user('all-manager');await post(edit('admin-owned',{region:'الغربية'}),403);
const newMachine={action:'save',kind:'factory',parentId:'admin-owned',data:{name:'Forbidden machine',machineBrand:'QA',machineModel:'QA',machineType:'mobile'}};
await post(newMachine,403);
user('rep');await post(newMachine,403);
user('cs');await post(edit('admin-owned',{phone:'0502222222'}),403);

// Existing eligible team routing remains usable. New/rerouted customers retain validation.
user('manager');await post(edit('peer-owned',{assignedTo:'rep'}));check(row('peer-owned').assigned_to,'rep');
for(const target of ['deleted-member',''])await post(edit('peer-owned',{assignedTo:target}),400);
await post(edit('peer-owned',{assignedTo:'owner'}),403);
await post(edit('peer-owned',{assignedTo:'west'}),400);
sql.prepare("UPDATE crm_members SET active=0 WHERE id='peer'").run();
await post(edit('peer-owned',{assignedTo:'peer'}),400);
await post(create({assignedTo:'peer',branch:'الرئيسي'}),400);
sql.prepare("UPDATE crm_members SET active=1 WHERE id='peer'").run();
await post(create({assignedTo:'owner',branch:'الرئيسي'}),403);

// Unchanged old routing needs no stale-assignee snapshot, but actor/root authorization
// is rechecked in the same transaction: revoked rights cannot commit a detail edit.
for(const actor of ['rep','manager'])for(const [column,value] of [['active',0],['region_scope','western'],['role','customer_service'],['auth_version',9],['branch','آخر'],['supervisor_id','owner']]){
 user(actor);const memberBefore=sql.prepare('SELECT * FROM crm_members WHERE id=?').get(actor),before=snapshot('admin-owned');
 race=()=>sql.prepare('UPDATE crm_members SET '+column+'=? WHERE id=?').run(value,actor);
 await post(edit('admin-owned',{phone:'0503333333'}),409);check(snapshot('admin-owned'),before);
 sql.prepare('UPDATE crm_members SET '+column+'=? WHERE id=?').run(memberBefore[column],actor);
}
user('rep');const beforeVersion=row('admin-owned').version;
race=()=>sql.prepare("UPDATE crm_records SET version=version+1,data=json_set(data,'$.phone','concurrent update') WHERE id='admin-owned'").run();
await post(edit('admin-owned',{phone:'0504444444'}),409);check(row('admin-owned').data.phone,'concurrent update');check(row('admin-owned').version,beforeVersion+1);
await post({...edit('admin-owned'),version:beforeVersion},409);
user('manager');const beforeActor=row('admin-owned').version;
race=()=>sql.prepare("UPDATE crm_records SET version=version+1,data=json_set(data,'$.region','الغربية') WHERE id='admin-owned'").run();
await post(edit('admin-owned',{phone:'0504444444'}),409);check(row('admin-owned').data.phone,'concurrent update');check(row('admin-owned').version,beforeActor+1);
user('supervisor');customer('supervisor-race','peer');const teamBefore=snapshot('supervisor-race');
race=()=>sql.prepare("UPDATE crm_members SET supervisor_id=NULL WHERE id='peer'").run();
await post(edit('supervisor-race',{phone:'0504444444'}),409);check(snapshot('supervisor-race'),teamBefore);
user(null);await post(edit('peer-owned'),401);
check(sql.prepare('PRAGMA foreign_key_check').all(),[]);
console.log(JSON.stringify({customerDetailEditAccessQA:'passed',checks,realSqlite:true,productionDataUsed:false,features:'regional rep/manager corrections with retained admin/inactive/outside/missing routing, immutable assignee/branch, unchanged routing eligibility on reassignment, supervisor team isolation, actor/root/team commit guards, map coordinates'}));
