// «طلبات تعديل بيانات العميل» (lib/customer-edit-requests*.ts), for the cases an independent mutation review (2026-11-22) found no test held:
// 1. the pure rules: a number that is not one reads as nothing, and the page's own check of a list (canDecide a yes or no);
// 2. the routes on an isolated in-memory SQLite (the real migrations, the session faked): a sales manager whose «العملاء · تحرير» is switched
//    off decides nothing; a request sent while the representative's supervisor is deactivated is the sales manager's, at commit too, and a
//    supervisor active again between the check and the commit keeps it from being approved; the sender alone may cancel (the list says
//    so to others); a sender's own request on a customer outside their regions now is not listed; the approval leaves the customer's
//    routing as its columns hold it. Synthetic people and customers only; no build, no network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'customer-edit-requests-rules-')),seen=new Set();
process.on('exit',()=>{fs.rmSync(out,{recursive:true,force:true});});
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=new Proxy({},{get:(_,key)=>globalThis.testEnv?.[key]});');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const u=globalThis.testUser;if(!u)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version FROM crm_members WHERE user_id=?').bind(u.userId).first();return {...u,provider:'email-otp',memberId:m?.id||'missing',memberVersion:m?.auth_version};}`);
function compile(relative){if(seen.has(relative))return;seen.add(relative);const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));if(/\.json$/.test(source)){const target=path.join(out,source);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,source),target);return 'from '+JSON.stringify(target)+' with {type:"json"}';}if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';compile(source);return 'from '+JSON.stringify(path.join(out,source.replace(/\.tsx?$/,'.mjs')));});fs.writeFileSync(dest,code);}
for(const name of ['crm','customer-edits'])compile('app/api/'+name+'/route.ts');
const rules=await import(pathToFileURL(path.join(out,'lib/customer-edit-requests.mjs')));

// ---- 1. The pure rules.
eq([rules.editText(Number.NaN),rules.editText(Infinity),rules.editText(0),rules.editText(12.5)],['','','0','12.5'],'A number that is not one is nothing; zero is a value');
const request={id:'r',customerId:'c',customerName:'مصنع',requestedByName:'مندوب',status:'pending',changes:[{field:'phone',before:'1',after:'2'}],canDecide:false,canCancel:true};
eq(rules.validCustomerEditList({me:'m',waiting:0,requests:[request]}),true,'A list as the route sends it');
eq(rules.validCustomerEditList({me:'m',waiting:0,requests:[{...request,canDecide:undefined}]}),false,'canDecide missing: not a list the page shows');
eq(rules.validCustomerEditList({me:'m',waiting:0,requests:[{...request,canDecide:'yes'}]}),false,'canDecide not a yes or no: refused');

// ---- 2. The routes.
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const f of fs.readdirSync(path.join(root,'drizzle')).filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync(path.join(root,'drizzle',f),'utf8'));
let race=null;
class Statement{constructor(q,a=[]){this.q=q;this.a=a;}bind(...a){return new Statement(this.q,a);}async run(){const r=sql.prepare(this.q).run(...this.a);return{meta:{changes:Number(r.changes)}};}async all(){return{results:sql.prepare(this.q).all(...this.a)};}async first(){return sql.prepare(this.q).get(...this.a)||null;}}
const DB={prepare:q=>new Statement(q),batch:async statements=>{if(race){const fn=race;race=null;await fn();}sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid'};
const now=new Date().toISOString();
const member=(id,role,sup=null,region='eastern')=>sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,1,0,?)').run(id,'u-'+id,id+'@yourrest.org','اسم '+id,role,'الرئيسي',sup,region,now);
member('owner','admin',null,'all');member('mgr','manager',null,'all');member('mgr2','manager',null,'all');member('sup','supervisor','mgr');member('rep','rep','sup');member('rep2','rep','sup');
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-owner')").run();
const user=id=>{globalThis.testUser=id?{userId:'u-'+id,email:id+'@yourrest.org',fullName:id}:null;};
const crm=await import(pathToFileURL(path.join(out,'app/api/crm/route.mjs'))),edits=await import(pathToFileURL(path.join(out,'app/api/customer-edits/route.mjs')));
const raw=id=>sql.prepare('SELECT * FROM crm_records WHERE id=?').get(id),row=id=>({...raw(id),data:JSON.parse(raw(id).data)});
const customer=(id,assignedTo,extra={})=>{const data={name:'مصنع '+id,region:'الشرقية',assignedTo,branch:'الرئيسي',location:'26.437341, 50.034499',phone:'0500000000',city:'الدمام',code:'ERP-'+id,...extra};sql.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,'customer',NULL,?,'الرئيسي',?,?,?,1)").run(id,assignedTo,JSON.stringify(data),now,now);};
const post=async(who,body,status=200)=>{user(who);const res=await crm.POST(new Request('https://test.invalid/api/crm',{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json'},body:JSON.stringify(body)})),data=await res.json();eq(res.status,status,who+' '+JSON.stringify(body).slice(0,120)+' -> '+JSON.stringify(data));return data;};
const list=async(who,customerId)=>{user(who);const res=await edits.GET(new Request('https://test.invalid/api/customer-edits'+(customerId?'?customerId='+encodeURIComponent(customerId):'')));eq(res.status,200,'list of '+who);return res.json();};
const edit=(id,extra={})=>{const value=row(id);return {action:'save',kind:'customer',id,version:value.version,editKey:crypto.randomUUID(),data:{...value.data,assignedTo:value.assigned_to,branch:value.branch,...extra}};};
const decide=(who,decision,id,status=200,note)=>post(who,{action:'customer-edit',decision,id,...(note===undefined?{}:{note})},status);
const requestOf=id=>sql.prepare("SELECT q.id FROM crm_audit q WHERE q.record_id=? AND q.action='customer-edit:request' AND NOT EXISTS (SELECT 1 FROM crm_audit d WHERE d.id='customer-edit-decision:'||q.id)").get(id)?.id;
const decided=id=>sql.prepare("SELECT action FROM crm_audit WHERE id=?").get('customer-edit-decision:'+id)?.action??null;

// A sales manager whose «العملاء · تحرير» is switched off decides nothing, not even a rejection.
customer('c1','rep');
await post('rep',edit('c1',{phone:'0501111111'}));let rid=requestOf('c1');
await decide('sup','approve',rid);
sql.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_by,updated_at) VALUES('mgr2','{\"customer:edit\":false}','[]',1,'owner',?)").run(now);
await decide('mgr2','reject',rid,403,'سبب الرفض');
eq(decided(rid),null,'nothing decided by the manager without the cell');
// The sender alone may cancel; the list says so to the sales manager too.
const forManager=(await list('mgr','c1')).requests.find(r=>r.id===rid);
eq([forManager.canDecide,forManager.canCancel],[true,false],'the sales manager decides and cannot cancel another\'s request');
await decide('mgr','reject',rid,200,'سبب الرفض');

// A request sent while the supervisor is deactivated goes to the sales manager, and is approved there (the commit reads the same rule).
customer('c2','rep');
sql.prepare("UPDATE crm_members SET active=0 WHERE id='sup'").run();
let sent=await post('rep',edit('c2',{phone:'0502222222'}));rid=requestOf('c2');
eq(sent.approvalStage,'sales_manager','no active supervisor: the sales manager');
sql.prepare("UPDATE crm_members SET active=1 WHERE id='sup'").run();
// It was sent to the sales manager (its stage), so a supervisor active again never holds it.
await decide('mgr','approve',rid);
eq([decided(rid),row('c2').data.phone],['customer-edit:approved','0502222222'],'approved and applied');

// A request sent to the supervisor, the supervisor deactivated afterwards: the sales manager's now, at commit too.
customer('c3','rep');
await post('rep',edit('c3',{phone:'0503333333'}));rid=requestOf('c3');
sql.prepare("UPDATE crm_members SET active=0 WHERE id='sup'").run();
eq((await list('mgr','c3')).requests.find(r=>r.id===rid).stage,'sales_manager','the deactivated supervisor no longer holds it');
// The supervisor active again between the check and the commit: the approval is refused, nothing applied.
race=()=>sql.prepare("UPDATE crm_members SET active=1 WHERE id='sup'").run();
await decide('mgr','approve',rid,409);
eq([decided(rid),row('c3').data.phone],[null,'0500000000'],'back with the supervisor at the commit: not approved');
sql.prepare("UPDATE crm_members SET active=0 WHERE id='sup'").run();
await decide('mgr','approve',rid);
eq([decided(rid),row('c3').data.phone],['customer-edit:approved','0503333333'],'with the supervisor still away: approved');
sql.prepare("UPDATE crm_members SET active=1 WHERE id='sup'").run();

// The approval leaves the routing as the columns hold it, whatever an older copy in the data says.
customer('c4','rep',{assignedTo:'rep2'});
await post('rep',edit('c4',{phone:'0504444444'}));rid=requestOf('c4');
await decide('sup','approve',rid);await decide('mgr','approve',rid);
eq([row('c4').assigned_to,row('c4').data.phone],['rep','0504444444'],'applied, the customer still the representative\'s');

// A sender's own request on a customer outside their regions now is not listed on that customer.
customer('c5','rep2');
await post('rep2',edit('c5',{phone:'0505555555'}));rid=requestOf('c5');
eq((await list('rep2','c5')).requests.some(r=>r.id===rid),true,'listed while in their regions');
sql.prepare("UPDATE crm_members SET region_scope='western' WHERE id='rep2'").run();
eq((await list('rep2','c5')).requests.some(r=>r.id===rid),false,'not once the customer is outside their regions');

console.log(JSON.stringify({ok:true,checks}));
