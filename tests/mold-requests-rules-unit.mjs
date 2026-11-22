// Mold requests on the server (lib/mold-requests-server.ts) and the customer's signing link (lib/mold-sign-server.ts): the claims, the answers
// and the stored status of production, for the cases an independent mutation review (2026-11-22) found no test held. Called directly on an
// in-memory SQLite with every migration and an in-memory object store, against a stand-in production that answers each call as the test
// says (so a change can be made in the database while a call is on its way, or between the read and the claim):
// - a send: the claim's version, its one-minute lease, the hold for a file deleted between the check and the claim, an edit saved while
//   the call was out (the answer must not overwrite it), a status about another request, «never sent» kept only while true, the first
//   failure of the timetable, a customer not in the CRM whose earlier attempt may have arrived, the oldest due first;
// - production's status stored: the same revision taken again, an answer without a revision, a cancelled status never restoring, an older
//   answer never restoring, MOLD_NEVER_SENT_SQL at the very instant of the attempt;
// - a design file: held while the CRM cancelled its request, refused when its bytes are not its size, files attached at the same moment in
//   their order; the status pull after its minute, only the requests asked; the sales manager's waiting list kept a minute;
// - the signing link: open only while the request has its sending to do, and a signed document's part read only with the bytes the page listed.
// Made-up requests, customers and members only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import {moldConfig} from '../portable/mold-client.mjs';
import {moldStatusObject} from '../portable/mold-rules.mjs';

const NativeDate=Date,origin=NativeDate.parse('2026-11-20T09:00:00.000Z'),started=NativeDate.now();let jump=0;
const nowMs=()=>origin+(NativeDate.now()-started)+jump;
globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[nowMs()]));}static now(){return nowMs();}};
const iso=(ms=nowMs())=>new NativeDate(ms).toISOString();

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'mold-requests-rules-unit-')),seen=new Set();
process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=new Proxy({},{get:(_,key)=>globalThis.moldServerEnv?.[key]});');
fs.writeFileSync(path.join(out,'auth.mjs'),'export async function getApplicationUser(){return null;}');
function compile(relative){
 if(seen.has(relative))return;seen.add(relative);
 const source=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));
 fs.mkdirSync(path.dirname(dest),{recursive:true});
 let code=ts.transpileModule(fs.readFileSync(source,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,quote,imported)=>{
  if(imported==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));
  if(imported==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));
  if(!imported.startsWith('.')&&!imported.startsWith('@/'))return match;
  let target=imported.startsWith('@/')?imported.slice(2):path.relative(root,path.resolve(path.dirname(source),imported));
  if(target.endsWith('.mjs'))return 'from '+JSON.stringify(path.join(root,target));
  if(!/\.tsx?$/.test(target))target+=fs.existsSync(path.join(root,target+'.ts'))?'.ts':'.tsx';
  compile(target);return 'from '+JSON.stringify(path.join(out,target.replace(/\.tsx?$/,'.mjs')));
 });
 fs.writeFileSync(dest,code);
}
compile('lib/mold-requests-server.ts');compile('lib/mold-sign-server.ts');
const S=await import(path.join(out,'lib/mold-requests-server.mjs')),G=await import(path.join(out,'lib/mold-sign-server.mjs'));

let checks=0;
const plain=value=>value===undefined?value:JSON.parse(JSON.stringify(value));
const eq=(actual,expected,message)=>{assert.deepEqual(plain(actual),plain(expected),message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};

const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const name of fs.readdirSync(path.join(root,'drizzle')).filter(name=>name.endsWith('.sql')).sort())sql.exec(fs.readFileSync(path.join(root,'drizzle',name),'utf8'));
/** before: [pattern, fn] run once just before the first statement whose text matches (a change made between a read and a write). */
const before=[];
class Statement{
 constructor(query,args=[]){this.query=query;this.args=args;}
 bind(...args){return new Statement(this.query,args);}
 execute(){const hook=before.findIndex(([pattern])=>pattern.test(this.query));if(hook>=0){const [,fn]=before.splice(hook,1)[0];fn();}const statement=sql.prepare(this.query);if(statement.columns().length)return {results:statement.all(...this.args),meta:{changes:0}};return {results:[],meta:{changes:Number(statement.run(...this.args).changes)}};}
 async first(){return sql.prepare(this.query).get(...this.args)||null;}
 async all(){return this.execute();}
 async run(){return this.execute();}
}
const DB={prepare:query=>new Statement(query),batch:async statements=>{sql.exec('BEGIN IMMEDIATE');try{const results=statements.map(statement=>statement.execute());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
const objects=new Map();
const store={async get(key){const bytes=objects.get(key);return bytes?{arrayBuffer:async()=>bytes.slice().buffer}:null;},async put(key,bytes){objects.set(key,new Uint8Array(bytes));},async delete(key){objects.delete(key);}};
globalThis.moldServerEnv={DB,FILES:store,YR_APP_ORIGIN:'https://crm.example.invalid'};
globalThis.__yourrestMoldRetry=1;

// The stand-in production: every call is recorded; `next` answers the next call (status, body, and anything to do while it is out).
const link=moldConfig({YR_PRODUCTS_API_URL:'https://products.example.invalid/api',YR_PRODUCTS_SECRET:'s'.repeat(40)});
const calls=[],next=[];
const status=(id,extra={})=>({crmRequestId:id,orderNo:7,status:'received',editable:true,stages:{},revision:1,...extra});
function defaultAnswer(route,payload){
 if(route==='requests')return [200,{request:status(payload.crmRequestId)}];
 if(route==='status')return [200,{requests:[],unknown:[]}];
 if(route==='pending')return [200,{requests:[]}];
 return [503,{error:{code:'unavailable',message:'x'}}];
}
const fetch=async(url,init)=>{
 const route=new URL(url).searchParams.get('route'),raw=Buffer.from(init.body),payload=route==='design-files'?JSON.parse(raw.subarray(0,raw.indexOf(10)).toString('utf8')):JSON.parse(raw.toString('utf8'));
 calls.push({route,payload});
 const step=next.shift(),[code,json]=step?await step(route,payload):defaultAnswer(route,payload);
 return {status:code,headers:new Headers(),arrayBuffer:async()=>Buffer.from(JSON.stringify(json))};
};
const routes=()=>calls.map(call=>call.route);

const specs={description:'200*400*27.5TH MM OPEN',core:'open',vibrators:2,model:'old',halfBlock:'none',moldWidth:1380,gelbaSize:795,moldNo:'YR099-9',quantity:1,designUrl:'',notes:''};
const linked={crmNumber:null,name:'مصنع تجريبي',address:'الدمام',city:'Damam - الدمام',erpCode:'E-1'};
sql.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES('factory','customer',NULL,'rep','الرئيسي',?,?,?,1,'fixture')").run(JSON.stringify({name:'مصنع تجريبي',region:'الشرقية',city:'الدمام'}),iso(),iso());
const factoryNo=Number(sql.prepare("SELECT number FROM crm_customer_numbers WHERE customer_id='factory'").get().number);
const inCrm={crmNumber:factoryNo,name:'مصنع تجريبي',address:'الدمام',city:'Damam - الدمام'};
const data=(customer=inCrm,extra={})=>({requestedAt:'2026-11-20T11:00:00+03:00',customer,salesman:{crmMemberId:'rep',name:'مندوب تجريبي',email:'rep@example.invalid'},specs,payment:'cash',...extra});
function insert(id,{d=data(),outbox='send',nextAt=iso(),accepted=null,remote=null,cancelledAt=null,lastAttemptAt=null,lastError=null,remoteAt=null,firstFailedAt=null,attempts=0}={}){
 sql.prepare('INSERT INTO crm_mold_requests(id,member_id,customer_id,data,accepted,cancelled_at,cancel_reason,outbox,attempts,first_failed_at,next_attempt_at,last_attempt_at,last_error,remote,remote_at,created_by,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)')
  .run(id,'rep','factory',JSON.stringify(d),accepted&&JSON.stringify(accepted),cancelledAt,'',outbox,attempts,firstFailedAt,nextAt,lastAttemptAt,lastError&&JSON.stringify(lastError),remote&&JSON.stringify(remote),remoteAt,'rep',iso(),iso());
}
const row=id=>{const r=sql.prepare('SELECT * FROM crm_mold_requests WHERE id=?').get(id);return {...r,data:JSON.parse(r.data),accepted:r.accepted&&JSON.parse(r.accepted),last_error:r.last_error&&JSON.parse(r.last_error),remote:r.remote&&JSON.parse(r.remote)};};
const send=id=>S.sendMoldRequest(DB,id,{link,fetch});
let fileSeq=0;
function addFile(requestId,{id='mdf-'+randomUUID(),bytes=Buffer.from('%PDF-1.4 made-up drawing '+(++fileSeq)),size=bytes.length,createdAt=iso(NativeDate.parse('2026-11-20T08:00:00.000Z')+fileSeq*1000),nextAt=iso()}={}){
 const key='mold-design/'+requestId+'/'+id;objects.set(key,new Uint8Array(bytes));
 sql.prepare("INSERT INTO crm_mold_design_files(id,request_id,member_id,name,kind,content_type,size,sha256,object_key,created_at,outbox,next_attempt_at,version,category) VALUES(?,?,'rep','drawing.pdf','pdf','application/pdf',?,'x',?,?,'send',?,1,'design')").run(id,requestId,size,key,createdAt,nextAt);
 return id;
}

// ---- 1. A send.
// The claim names the version read: a change saved between the read and the claim leaves the send to the next try.
insert('mr-version');
before.push([/SET mutation_id=\?,last_attempt_at=\?/,()=>sql.prepare("UPDATE crm_mold_requests SET version=version+1 WHERE id='mr-version'").run()]);
eq([await send('mr-version'),calls.length],[{kind:'busy',code:''},0],'changed between the read and the claim: nothing sent');
// The claim holds the request a minute while the call is out.
insert('mr-lease');let during=null;
next.push(async(route,payload)=>{during=row('mr-lease');return defaultAnswer(route,payload);});
eq((await send('mr-lease')).kind,'ok','sent');
eq(NativeDate.parse(during.next_attempt_at)-NativeDate.parse(during.last_attempt_at),60_000,'while the call is out the request is leased for a minute');
// A request asked for under the rule of the design file, whose only design file is deleted between the check and the claim: kept.
insert('mr-held',{d:data(inCrm,{designRequired:true})});const drawing=addFile('mr-held');
before.push([/SET mutation_id=\?,last_attempt_at=\?/,()=>sql.prepare('UPDATE crm_mold_design_files SET deleted_at=? WHERE id=?').run(iso(),drawing)]);
calls.length=0;
eq([await send('mr-held'),calls.length],[{kind:'none',code:'design_file'},0],'its design file deleted before the claim: kept for it, nothing sent');
// An edit saved while the call was out wins over the answer.
insert('mr-edit');
next.push(async(route,payload)=>{sql.prepare("UPDATE crm_mold_requests SET data=json_set(data,'$.specs.notes','edited'),mutation_id='edit',version=version+1,next_attempt_at=? WHERE id='mr-edit'").run(iso());return defaultAnswer(route,payload);});
await send('mr-edit');
eq([row('mr-edit').outbox,row('mr-edit').accepted,row('mr-edit').data.specs.notes],['send',null,'edited'],'the answer does not overwrite the edit saved meanwhile');
// A status about another request is not this request's.
insert('mr-other');insert('mr-elsewhere',{outbox:null,nextAt:null,accepted:data()});
next.push(async()=>[200,{request:status('mr-elsewhere',{status:'in_production'})}]);
eq((await send('mr-other')).kind,'ok','production answered ok');
eq([row('mr-other').remote,row('mr-elsewhere').remote],[null,null],'the other request\'s status is stored on neither');
// «never sent» only while every attempt was refused before production stored the request.
insert('mr-maybe',{lastAttemptAt:iso(nowMs()-120_000),lastError:{code:'timeout',http:0,at:iso(nowMs()-110_000)}});
next.push(async()=>[404,{}]);
await send('mr-maybe');
eq(row('mr-maybe').last_error.notStored,undefined,'an earlier attempt may have arrived: not marked never sent');
// The timetable counts from the first failure.
const firstFailure=iso(nowMs()-3600_000);
insert('mr-retry',{attempts:2,firstFailedAt:firstFailure,lastAttemptAt:iso(nowMs()-600_000),lastError:{code:'timeout',http:0,at:iso(nowMs()-590_000)}});
next.push(async()=>[503,{error:{code:'unavailable',message:'x'}}]);
await send('mr-retry');
eq([row('mr-retry').first_failed_at,row('mr-retry').attempts],[firstFailure,3],'its first failure kept, the attempts counted');
// A customer not in the CRM, an earlier attempt of which may have reached production: sent as it is, never held for production's update.
insert('mr-free',{d:data(linked),lastAttemptAt:iso(nowMs()-120_000),lastError:{code:'timeout',http:0,at:iso(nowMs()-110_000)}});
calls.length=0;
eq((await send('mr-free')).kind,'ok','sent');
eq(routes(),['requests'],'its send, not a wait for the update');
// The oldest due first.
sql.prepare("UPDATE crm_mold_requests SET outbox=NULL,next_attempt_at=NULL").run();
insert('mr-later',{nextAt:iso(nowMs()-60_000)});insert('mr-earlier',{nextAt:iso(nowMs()-120_000)});
calls.length=0;
await S.sendDueMoldRequests(DB,{limit:1,link,fetch});
eq(calls.filter(call=>call.route==='requests').map(call=>call.payload.crmRequestId),['mr-earlier'],'one at a time: the one due longest');

// ---- 2. Production's status stored.
insert('mr-status',{outbox:null,nextAt:null,accepted:data()});
const remote=extra=>moldStatusObject(status('mr-status',extra));
await S.storeMoldRemote(DB,'mr-status',remote({revision:5}),'2026-11-20T09:10:00.000Z');
await S.storeMoldRemote(DB,'mr-status',remote({revision:5,status:'confirmed'}),'2026-11-20T09:20:00.000Z');
eq([row('mr-status').remote.status,row('mr-status').remote_at],['confirmed','2026-11-20T09:20:00.000Z'],'the same revision again: taken, with its time');
await S.storeMoldRemote(DB,'mr-status',remote({revision:4,status:'received'}),'2026-11-20T09:25:00.000Z');
eq([row('mr-status').remote.status,row('mr-status').remote_at],['confirmed','2026-11-20T09:20:00.000Z'],'an older revision is not');
await S.storeMoldRemote(DB,'mr-status',remote({revision:null,status:'in_production'}),'2026-11-20T09:30:00.000Z');
eq([row('mr-status').remote.status,row('mr-status').remote_at],['in_production','2026-11-20T09:30:00.000Z'],'an answer without a revision is always taken');
// The CRM cancelled it and production shows it cancelled: a newer cancelled status restores nothing.
insert('mr-cancelled',{outbox:null,nextAt:null,accepted:data(),cancelledAt:'2026-11-20T08:30:00.000Z',remote:status('mr-cancelled',{status:'cancelled',revision:3}),remoteAt:'2026-11-20T08:40:00.000Z'});
await S.storeMoldRemote(DB,'mr-cancelled',moldStatusObject(status('mr-cancelled',{status:'cancelled',revision:4})),'2026-11-20T09:00:00.000Z');
eq([row('mr-cancelled').cancelled_at,row('mr-cancelled').remote.revision],['2026-11-20T08:30:00.000Z',4],'still cancelled, the newer status stored');
// An older answer that is not cancelled never restores a request production cancelled since.
await S.storeMoldRemote(DB,'mr-cancelled',moldStatusObject(status('mr-cancelled',{status:'received',revision:2})),'2026-11-20T09:05:00.000Z');
eq([row('mr-cancelled').cancelled_at,row('mr-cancelled').remote.status],['2026-11-20T08:30:00.000Z','cancelled'],'an older revision restores nothing');
// MOLD_NEVER_SENT_SQL reads an error written at the very instant of the attempt as moldNeverSent does.
insert('mr-instant',{lastAttemptAt:'2026-11-20T09:00:00.000Z',lastError:{code:'invalid_payload',http:400,at:'2026-11-20T09:00:00.000Z',notStored:true}});
eq(sql.prepare(`SELECT ${S.MOLD_NEVER_SENT_SQL} AS never FROM crm_mold_requests WHERE id='mr-instant'`).get().never,1,'refused at the same instant it was tried: never sent');

// ---- 3. Design files, the status pull and the waiting list.
insert('mr-crm-cancelled',{outbox:null,nextAt:null,accepted:data(),cancelledAt:iso()});
const heldFile=addFile('mr-crm-cancelled');calls.length=0;
eq([await S.sendMoldDesignFile(DB,heldFile,{link,fetch,files:store}),calls.length],[{kind:'none',code:'held'},0],'a file of a request the CRM cancelled: held');
insert('mr-files',{outbox:null,nextAt:null,accepted:data()});
const short=addFile('mr-files',{size:999});calls.length=0;
eq([(await S.sendMoldDesignFile(DB,short,{link,fetch,files:store})).code,calls.length],['file_missing',0],'bytes that are not the file\'s size: refused, nothing sent');
sql.prepare("UPDATE crm_mold_design_files SET outbox=NULL,next_attempt_at=NULL").run();
const same='2026-11-20T08:59:00.000Z';
const first=addFile('mr-files',{id:'mdf-aaaa',createdAt:same,nextAt:iso(nowMs()-60_000)}),second=addFile('mr-files',{id:'mdf-bbbb',createdAt:same,nextAt:iso(nowMs()-120_000)});
calls.length=0;
await S.sendDueMoldDesignFiles(DB,{limit:2,link,fetch,files:store});
eq(calls.filter(call=>call.route==='design-files')[0]?.payload.crmFileId,first,'attached at the same moment: the first by its id goes first, whatever its next try');
ok(second,'(the second waits behind it)');
// The status pull: a status older than a minute is asked again, and only the requests asked are stored.
insert('mr-pull',{outbox:null,nextAt:null,accepted:data(),remote:status('mr-pull'),remoteAt:iso(nowMs()-120_000)});
insert('mr-unasked',{outbox:null,nextAt:null,accepted:data()});
next.push(async()=>[200,{requests:[status('mr-pull',{status:'confirmed',revision:2}),status('mr-unasked',{status:'in_production'})],unknown:[]}]);
calls.length=0;
eq(await S.pullMoldStatuses(DB,[await S.loadMoldRequest(DB,'mr-pull')],{link,fetch}),null,'pulled');
eq([routes(),row('mr-pull').remote.status,row('mr-unasked').remote],[['status'],'confirmed',null],'two minutes old: asked again; a status not asked for is not stored');
// The sales manager's waiting list is kept a minute.
S.forgetPendingApprovals();calls.length=0;
await S.pullPendingApprovals({link,fetch});await S.pullPendingApprovals({link,fetch});
eq(routes(),['pending'],'asked once within the minute');

// ---- 4. The signing link.
const link14={hash:'h',sentAt:iso(),expiresAt:iso(nowMs()+86_400_000),by:'rep'};
const waiting=extra=>({id:'mr-sign',outbox:'send',cancelledAt:null,accepted:null,remote:null,lastAttemptAt:null,lastError:null,data:{...data(),awaitsSignature:true,signatureLink:link14},...extra});
eq([G.signLinkOpen(waiting()),G.signLinkOpen(waiting({outbox:null}))],[true,false],'open while its sending waits for the signature; with nothing to send, closed');
const bytes=Buffer.from('%PDF-1.4 the quotation the page listed'),sha=createHash('sha256').update(bytes).digest('hex');
objects.set('doc/q',new Uint8Array(bytes));objects.set('doc/other',new Uint8Array(Buffer.from('%PDF-1.4 another file'.padEnd(bytes.length,'x'))));
const part={kind:'pdf',name:'q.pdf',sha256:sha,pages:1};
const [good]=G.signedDocSources([part],[{objectKey:'doc/q',size:bytes.length}],store),[changed]=G.signedDocSources([part],[{objectKey:'doc/other',size:bytes.length}],store);
eq([Buffer.from(await good.read()).equals(bytes),await changed.read()],[true,null],'a part is read only with the bytes the page listed');

console.log(JSON.stringify({ok:true,checks}));
