// Characterization of existing contact evidence policy through real routes and migrated SQLite.
// Identity is mocked; no network, production data, or object storage is used.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'contact-evidence-policy-')),seen=new Set();
process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const u=globalThis.testUser;if(!u)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version FROM crm_members WHERE user_id=? OR email=?').bind(u.userId,u.email).first();return {...u,provider:'email-otp',memberId:m?.id||'missing',memberVersion:m?.auth_version};}`);
function compile(relative){
 if(seen.has(relative))return;seen.add(relative);
 const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});
 let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
  if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));
  if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));
  if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
  let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
  if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';
  compile(source);return 'from '+JSON.stringify(path.join(out,source.replace(/\.tsx?$/,'.mjs')));
 });fs.writeFileSync(dest,code);
}
for(const name of ['crm','visits','followups'])compile('app/api/'+name+'/route.ts');
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const filename of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+filename,'utf8'));
class Statement {
 constructor(q,a=[]){this.q=q;this.a=a;}
 bind(...a){return new Statement(this.q,a);}
 async run(){return{meta:{changes:Number(sql.prepare(this.q).run(...this.a).changes)}};}
 async all(){return{results:sql.prepare(this.q).all(...this.a)};}
 async first(){return sql.prepare(this.q).get(...this.a)||null;}
}
const DB={prepare:q=>new Statement(q),batch:async statements=>{sql.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid'};
const NativeDate=Date,clock=NativeDate.parse('2026-10-07T09:00:00.000Z');
globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
process.on('exit',()=>{globalThis.Date=NativeDate;});
const now=new Date().toISOString(),day='2026-10-07',start='2026-10-06T22:00:00.000Z',end='2026-10-07T00:00:00.000Z';
const routes={};for(const name of ['crm','visits','followups'])routes[name]=await import(path.join(out,'app/api/'+name+'/route.mjs'));
let checks=0,cases=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const ok=(actual,message)=>{assert(actual,message);checks++;};
const raw=id=>sql.prepare('SELECT * FROM crm_records WHERE id=?').get(id);
const data=id=>JSON.parse(raw(id).data);
const activityCount=()=>sql.prepare("SELECT count(*) n FROM crm_records WHERE kind='activity'").get().n;
const auditCount=()=>sql.prepare('SELECT count(*) n FROM crm_audit').get().n;
const contact={type:'call',date:'2026-10-06',summary:'تعريف بمنتجات الشركة',result:'متابعة العميل',nextAction:'التواصل التالي',nextDate:day,location:'26.437341, 50.034499',locationSource:'device',locationCapturedAt:now,locationAccuracy:12,startedAt:start,endedAt:end,performedBy:'spoofed',recordedByEmail:'spoofed@example.invalid',visitNumber:999999,durationSeconds:999999,latitude:-1,longitude:-1};
function setup(){
 sql.exec('DELETE FROM crm_audit; DELETE FROM crm_visit_numbers; DELETE FROM crm_records; DELETE FROM crm_members;');
 for(const [id,role] of [['admin','admin'],['rep','rep'],['other','rep']])sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,1,0,?)').run(id,'u-'+id,id+'@yourrest.org',id,role,'HQ','all',now);
 sql.prepare('INSERT INTO crm_records(id,kind,assigned_to,branch,data,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('customer','customer','rep','HQ',JSON.stringify({name:'Synthetic customer',region:'الشرقية'}),now,now);
 globalThis.testUser={userId:'u-rep',email:'REP@yourrest.org',fullName:'rep'};
}
function payload(route,patch={},extra={}){
 const key=crypto.randomUUID(),value={...contact,...patch};
 if(route==='crm')return{action:'save',kind:'activity',createKey:key,parentId:'customer',data:value,...extra};
 if(route==='visits')return{createKey:key,customerId:'customer',customerVersion:raw('customer').version,data:value,...extra};
 return{createKey:key,parentId:'customer',data:{hasRequest:false,followupTitle:'Synthetic followup',stage:'new',nextAction:'التواصل التالي',nextDate:day,quantity:1},contact:value,...extra};
}
async function post(route,body,status=200,label=''){
 const response=await routes[route].POST(new Request('https://test.invalid/api/'+route,{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json'},body:JSON.stringify(body)}));
 const result=await response.json();eq(response.status,status,route+' '+label+' '+JSON.stringify(result));return result;
}
const savedContact=(route,result)=>route==='followups'?result.visitId:result.id;
for(const route of Object.keys(routes)){
 setup();let body=payload(route),result=await post(route,body),id=savedContact(route,result),saved=data(id);cases++;
 eq(saved.performedBy,'rep','Authenticated author wins over browser');eq(saved.recordedByEmail,'rep@yourrest.org','Recorded email comes from session');
 eq(saved.responsibleId,route==='crm'?'':'rep','Legacy CRM intentionally retains its empty responsibleId');
 eq(saved.latitude,26.437341);eq(saved.longitude,50.034499);eq(saved.locationCapturedAt,now);eq(saved.locationAccuracy,12);
 eq(saved.startedAt,start);eq(saved.endedAt,end);eq(saved.durationSeconds,7200);eq(saved.durationReview,false);eq(saved.date,day,'Day derives from Riyadh start time');ok(saved.visitNumber>0&&saved.visitNumber!==999999,'Server allocates visit number');
 const beforeCount=activityCount(),beforeAudits=auditCount();eq((await post(route,body)).alreadySaved,true);eq(activityCount(),beforeCount);eq(auditCount(),beforeAudits);eq(data(id),saved,'Identical replay cannot replace evidence');
 const changed=structuredClone(body);(route==='followups'?changed.contact:changed.data).summary='Changed retry';await post(route,changed,409,'Changed retry');eq(data(id),saved);
 for(const [label,patch,extra,status] of [
  ['missing start',{startedAt:''},{},400],
  ['reversed times',{startedAt:end,endedAt:start},{},400],
  ['future start',{startedAt:'2026-10-07T09:02:00.000Z',endedAt:''},{},400],
  ['future end',{endedAt:'2026-10-07T09:02:00.000Z'},{},400],
  ['result absent',{result:'',outcome:'pending'},{},400],
  ['legacy result fallback',{result:'',outcome:'effective'},{},200],
  ['invalid location',{location:'not coordinates'},{},400],
  ['missing device evidence',{locationSource:undefined},{},400],
  ['missing accuracy',{locationAccuracy:undefined},{},400],
  ['future location',{locationCapturedAt:'2026-10-07T09:02:00.000Z'},{},400],
  ['finish without start',{startedAt:'',endedAt:''},{clockAction:'finish'},400],
  ['start clock replaces untrusted times',{startedAt:'2026-10-07T09:02:00.000Z',endedAt:'2026-10-07T09:03:00.000Z'},{clockAction:'start'},200],
  ['finish clock replaces end',{endedAt:''},{clockAction:'finish'},200],
  ['open contact',{startedAt:start,endedAt:''},{},200],
  ['untimed contact',{startedAt:'',endedAt:''},{},200],
 ]){
  setup();body=payload(route,patch,extra);result=await post(route,body,status,label);cases++;
  if(status!==200){eq(activityCount(),0,label+' does not leave an activity');eq(auditCount(),0,label+' does not leave an audit');continue;}
  saved=data(savedContact(route,result));
  if(extra.clockAction==='start'){eq(saved.startedAt,now);eq(saved.endedAt,'');eq(saved.durationSeconds,null);eq(saved.date,day);}
  if(extra.clockAction==='finish'){eq(saved.startedAt,start);eq(saved.endedAt,now);eq(saved.durationSeconds,39600);}
  if(label==='open contact'||label==='untimed contact'){eq(saved.durationSeconds,null);eq(saved.durationReview,false);}
 }
}
// Author/location evidence and retry markers survive administrative edits on both activity APIs.
for(const route of ['crm','visits']){
 setup();const first=payload(route),created=await post(route,first),id=created.id,old=data(id);cases++;
 globalThis.testUser={userId:'u-admin',email:'admin@yourrest.org',fullName:'admin'};
 const editBody=payload(route,{...old,summary:'Updated by administrator',performedBy:'admin',recordedByEmail:'admin@yourrest.org',visitNumber:8888,latitude:-20,longitude:-30,locationCapturedAt:'2026-10-06T00:00:00.000Z',locationAccuracy:999},{id,version:raw(id).version});
 // Legacy fields remain omitted in the legacy endpoint, whose schema fills defaults.
 if(route==='crm')for(const name of ['visitWorkflow','responsibleId','customerStage','salesStage','strength','requestedProducts','hasCompetitor','competitorName','competitorNotes','competitorFileId','competitorFileName','customerNeeds','requestId','requestSnapshot'])delete editBody.data[name];
 await post(route,editBody);const updated=data(id);
 for(const name of ['performedBy','recordedByEmail','visitNumber','location','latitude','longitude','locationCapturedAt','locationAccuracy','responsibleId'])eq(updated[name],old[name],name+' survives administrator edit');
 for(const name of ['_creationRequest','_startRequest','_finishRequest'])eq(updated[name],old[name],name+' historical retry marker survives');
 const count=activityCount(),audits=auditCount();eq((await post(route,editBody,route==='crm'?409:200)).alreadySaved,route==='crm'?undefined:true,'Modern edits carry durable receipt; legacy edits use row version');
 if(route==='visits'){eq(activityCount(),count);eq(auditCount(),audits);}
 const move=structuredClone(editBody);move.createKey=crypto.randomUUID();move.version=raw(id).version;move.data.location='25.0, 45.0';if(route==='visits')move.customerVersion=raw('customer').version;
 await post(route,move,400,'Saved GPS remains immutable');eq(data(id),updated);
}
eq(sql.prepare('PRAGMA foreign_key_check').all(),[]);
console.log(JSON.stringify({ok:true,checks,cases,type:'contact evidence policy characterization; real CRM, visit and legacy followup handlers; SQLite'}));
sql.close();
