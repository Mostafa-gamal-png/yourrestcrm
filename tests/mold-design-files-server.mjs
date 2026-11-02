// Mold design files on the server (the contract's addition of 2026-11-02): the real lib/mold-requests-server.ts and the attach, delete,
// resend and download routes, transpiled (no build), on a migrated SQLite and the private object store, against the stand-in production
// API. A deletion that stopped after 24 hours is restarted by resend; a deletion production refuses keeps the file with its reason; a
// refusal without the contract's code (a web server's 400/413) is final and takes none of the 10 places; an older status never replaces
// a newer one (a pull, a request's send, an approval); a download keeps its place until its body is read or abandoned, the CRM's own
// copies too. Synthetic data only; the shared secret is never printed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {request as httpsRequest} from 'node:https';
import {startProductsMock} from '../scripts/lib/products-mock.mjs';
import {privateObjects} from '../portable/storage.mjs';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'mold-design-server-')),store=fs.mkdtempSync(path.join(os.tmpdir(),'mold-design-objects-')),seen=new Set();
process.on('exit',()=>{fs.rmSync(out,{recursive:true,force:true});fs.rmSync(store,{recursive:true,force:true});});
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.moldTestEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),'export async function getApplicationUser(){return globalThis.moldTestUser||null;}');
function compile(relative){
 if(seen.has(relative))return;seen.add(relative);
 const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});
 let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
  if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));
  if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));
  if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
  let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
  // The portable modules are plain JavaScript: used as they are.
  if(source.endsWith('.mjs'))return 'from '+JSON.stringify(path.join(root,source));
  if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';
  compile(source);return 'from '+JSON.stringify(path.join(out,source.replace(/\.tsx?$/,'.mjs')));
 });fs.writeFileSync(dest,code);
}
for(const route of ['app/api/mold-requests/route.ts','app/api/mold-requests/design-files/route.ts','app/api/mold-requests/design-files/delete/route.ts','app/api/mold-requests/design-file/route.ts'])compile(route);

const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const name of fs.readdirSync('drizzle').filter(name=>name.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+name,'utf8'));
class Statement{
 constructor(query,args=[]){this.query=query;this.args=args;}
 bind(...args){return new Statement(this.query,args);}
 execute(){const statement=sql.prepare(this.query);if(statement.columns().length)return {results:statement.all(...this.args),meta:{changes:0}};return {results:[],meta:{changes:Number(statement.run(...this.args).changes)}};}
 async first(){return sql.prepare(this.query).get(...this.args)||null;}
 async all(){return this.execute();}
 async run(){return this.execute();}
}
const DB={prepare:query=>new Statement(query),batch:async statements=>{sql.exec('BEGIN IMMEDIATE');try{const results=statements.map(statement=>statement.execute());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};

let checks=0;
const check=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const mock=await startProductsMock(),authority=fs.readFileSync(mock.ca);
/** The stand-in production over HTTPS with its own authority; `answering` stands in for one route when a test needs another answer. */
const viaMock=(url,init)=>new Promise((resolve,reject)=>{
 const req=httpsRequest(url,{method:init.method,headers:init.headers,ca:authority,signal:init.signal},res=>{
  const headers=new Headers(Object.entries(res.headers).flatMap(([key,value])=>Array.isArray(value)?value.map(item=>[key,item]):[[key,value]]));
  const parts=[];res.on('data',part=>parts.push(part));res.on('end',()=>{const bytes=Buffer.concat(parts);resolve({status:res.statusCode,headers,arrayBuffer:async()=>bytes});});
 });
 req.on('error',error=>reject(init.signal?.aborted?Object.assign(new Error('timeout'),{name:'TimeoutError'}):error));req.end(init.body);
});
const stub=(route,http,body,type='application/json')=>(url,init)=>new URL(url).searchParams.get('route')!==route?viaMock(url,init)
 :Promise.resolve({status:http,headers:new Headers({'content-type':type}),arrayBuffer:async()=>Buffer.from(typeof body==='string'?body:JSON.stringify(body))});
let answering=null;
globalThis.fetch=(url,init)=>(answering||viaMock)(url,init);
const objects=privateObjects(store);
globalThis.moldTestEnv={DB,FILES:objects,YR_APP_ORIGIN:'https://test.invalid',YR_PRODUCTS_API_URL:mock.url,YR_PRODUCTS_SECRET:mock.state.secret};
// The timer of keepMoldRetrying stays off: every send here is the test's own (or a route's).
globalThis.__yourrestMoldRetry=1;

try{
 const now=new Date().toISOString();
 for(const [id,role,scope] of [['rep','rep','eastern'],['rep2','rep','eastern'],['manager','manager','all']])sql.prepare("INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,'الرئيسي','',?,1,0,?)").run(id,'u-'+id,id+'@yourrest.org','عضو '+id,role,scope,now);
 sql.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES('factory','customer',NULL,'rep','الرئيسي',?,?,?,1,'fixture')").run(JSON.stringify({name:'مصنع تجريبي',region:'الشرقية',city:'الدمام'}),now,now);
 const server=await import(path.join(out,'lib/mold-requests-server.mjs')),lib=await import(path.join(out,'lib/mold-requests.mjs'));
 const requests=await import(path.join(out,'app/api/mold-requests/route.mjs')),attacher=await import(path.join(out,'app/api/mold-requests/design-files/route.mjs'));
 const remover=await import(path.join(out,'app/api/mold-requests/design-files/delete/route.mjs')),downloader=await import(path.join(out,'app/api/mold-requests/design-file/route.mjs'));
 const link=server.productsLink();
 const as=member=>{globalThis.moldTestUser={userId:'u-'+member,email:member+'@yourrest.org',memberId:member,memberVersion:1,provider:'email-otp'};};
 const json=async response=>({status:response.status,body:await response.json()});
 const post=(url,body)=>new Request('https://test.invalid'+url,{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json'},body:JSON.stringify(body)});
 const pdf=label=>Buffer.from('%PDF-1.7 synthetic drawing '+label);
 const fileRow=id=>sql.prepare('SELECT * FROM crm_mold_design_files WHERE id=?').get(id);
 const errorOf=id=>JSON.parse(fileRow(id).last_error||'null');
 const until=async(test,ms=5000)=>{const end=Date.now()+ms;while(!test()){if(Date.now()>end)throw Error('timed out waiting');await new Promise(resolve=>setTimeout(resolve,20));}};
 const filesOf=id=>server.loadMoldDesignFiles(DB,'request_id=?',[id]);
 const viewOf=async(id,me={id:'rep',role:'rep'})=>lib.moldRequestView(await server.loadMoldRequest(DB,id),me,[],true,await filesOf(id));
 const atProduction=(id,fileId)=>(mock.row(id).designFiles||[]).some(file=>file.crmFileId===fileId);
 async function newRequest(){
  const id='mr-'+randomUUID(),at=new Date().toISOString();
  const data={requestedAt:'2026-11-02T10:00:00+03:00',customer:{crmNumber:27,name:'مصنع تجريبي',address:'الدمام',city:'Damam - الدمام'},salesman:{crmMemberId:'rep',name:'مندوب تجريبي',email:'rep@yourrest.org'},
   specs:{description:'200*400*27.5TH MM OPEN',core:'open',vibrators:2,model:'old',halfBlock:'none',moldWidth:1380,gelbaSize:795,moldNo:'YR099-9',quantity:1,designUrl:'',notes:''}};
  sql.prepare("INSERT INTO crm_mold_requests(id,member_id,customer_id,data,outbox,next_attempt_at,created_by,created_at,updated_at,version) VALUES(?,'rep','factory',?,'send',?,'rep',?,?,1)").run(id,JSON.stringify(data),at,at,at);
  assert.equal((await server.sendMoldRequest(DB,id,{link})).kind,'ok');
  return id;
 }
 async function attach(id,name,bytes,member='rep'){
  const form=new FormData();form.set('requestId',randomUUID());form.set('id',id);form.set('file',new File([bytes],name));
  as(member);return json(await attacher.POST(new Request('https://test.invalid/api/mold-requests/design-files',{method:'POST',headers:{origin:'https://test.invalid'},body:form})));
 }
 const remove=async(id,fileId,member='rep')=>{as(member);return json(await remover.POST(post('/api/mold-requests/design-files/delete',{requestId:randomUUID(),id,fileId})));};
 const resend=async(id,member='rep')=>{as(member);return json(await requests.POST(post('/api/mold-requests',{action:'resend',requestId:randomUUID(),id})));};
 const download=async(query,member='rep')=>{as(member);return downloader.GET(new Request('https://test.invalid/api/mold-requests/design-file?'+query));};

 // ---- 1. A deletion whose tries ran out (production unreachable for 24 hours) is not stuck: resend starts it again
 {
  const id=await newRequest();
  let answer=await attach(id,'رسم القالب 1380.pdf',pdf('first'));
  check([answer.status,answer.body.file.state],[200,'sent'],'attached, and sent at once');
  const fileId=answer.body.file.crmFileId;
  mock.state.down=true;
  answer=await remove(id,fileId);
  check([answer.status,fileRow(fileId).outbox,errorOf(fileId).code],[200,'delete','network'],'production unreachable: the deletion waits on the timetable');
  let clock=Date.now();const at=()=>new Date(clock).toISOString();
  for(let n=0;n<40&&fileRow(fileId).next_attempt_at;n++){clock=Date.parse(fileRow(fileId).next_attempt_at)+1000;await server.sendMoldDesignFile(DB,fileId,{link,now:at});}
  const stopped=fileRow(fileId);
  check([stopped.outbox,stopped.next_attempt_at,!!stopped.deleted_at,!!stopped.object_key,errorOf(fileId).final],['delete',null,true,true,undefined],'after 24 hours of failures the deletion stops, not refused');
  let shown=await viewOf(id);
  check([shown.designFiles.find(file=>file.crmFileId===fileId).state,shown.can.resend,lib.moldDesignStopped((await filesOf(id))[0])],['deleting',true,true],'shown as being deleted; the requester may resend');
  check((await viewOf(id,{id:'manager',role:'manager'})).can.resend,false,'resend is the requester\'s alone');
  check((await resend(id,'manager')).status,403,'the sales manager may not resend it');
  mock.state.down=false;
  answer=await resend(id);
  check(answer.status,200,'the requester resends (no 403 «لمن طلبه»)');
  await until(()=>fileRow(fileId).outbox===null);
  check([!!fileRow(fileId).deleted_at,fileRow(fileId).object_key,atProduction(id,fileId),await objects.get(stopped.object_key)],[true,null,false,null],'the deletion reached production; the bytes left the CRM');
  shown=await viewOf(id);
  check([shown.designFiles.length,lib.moldDesignCount(await server.loadMoldRequest(DB,id),await filesOf(id)).crm,shown.can.resend],[0,0,false],'it is gone from the request and frees its place among the 10');
 }

 // ---- 2. A deletion production refuses for good (a 400, here without the contract's JSON): the file stays, with the reason
 {
  const id=await newRequest();
  const fileId=(await attach(id,'مقطع القالب.dxf',Buffer.from('0\nSECTION\n2\nENTITIES\n'))).body.file.crmFileId;
  answering=stub('design-file-delete',400,'<html>400 Bad Request</html>','text/html');
  let answer=await remove(id,fileId);
  answering=null;
  const kept=fileRow(fileId);
  check([answer.status,answer.body.send.kind,kept.deleted_at,kept.outbox,kept.next_attempt_at,errorOf(fileId).code,errorOf(fileId).http,errorOf(fileId).final],[200,'rejected',null,null,null,'http_400',400,true],'refused: not deleting for ever, the file restored with the reason');
  const shown=answer.body.request.designFiles.find(file=>file.crmFileId===fileId);
  check([shown.state,shown.error.code,shown.canDelete,answer.body.request.can.resend,atProduction(id,fileId)],['sent','http_400',true,false,true],'shown as production holds it, with the reason; it may be deleted again; nothing to resend');
  answer=await remove(id,fileId);
  check([answer.status,fileRow(fileId).outbox,!!fileRow(fileId).deleted_at,atProduction(id,fileId)],[200,null,true,false],'deleted again once production accepts: gone');
 }

 // ---- 3. A send refused without the contract's code (a web server's 413 in front of production) is final, and takes no place
 {
  const id=await newRequest();
  answering=stub('design-files',413,'<html>413 Request Entity Too Large</html>','text/html');
  let answer=await attach(id,'مخطط كبير.pdf',pdf('too large for the web server'));
  answering=null;
  const fileId=answer.body.file.crmFileId,files=await filesOf(id);
  check([answer.status,answer.body.file.state,answer.body.file.error.code,errorOf(fileId).final,fileRow(fileId).next_attempt_at],[200,'rejected','http_413',true,null],'refused for good, shown with its reason (not «waiting»)');
  check([lib.moldDesignRefused(files[0]),lib.moldDesignMayBeRemote(files[0]),lib.moldDesignStopped(files[0]),(await viewOf(id)).can.resend],[true,false,false,false],'not held by production, nothing to resend');
  answer=await resend(id);
  check([answer.status,answer.body.error],[409,'وصل الطلب للإنتاج؛ لا شيء ينتظر الإرسال'],'resend: nothing waits (the requester is not told «لمن طلبه»)');
  for(let n=1;n<=10;n++)check((await attach(id,'drawing '+n+'.dwg',Uint8Array.of(n))).body.file?.state,'sent','file '+n+' of 10 beside the refused one');
  answer=await attach(id,'one more.dwg',Uint8Array.of(42));
  check([answer.status,/الحد 10 ملفات/.test(answer.body.error)],[409,true],'the eleventh live file is refused by the CRM itself');
  const deletesBefore=mock.state.calls.filter(call=>call.route==='design-file-delete').length;
  answer=await remove(id,fileId);
  check([answer.status,!!fileRow(fileId).deleted_at,fileRow(fileId).object_key,mock.state.calls.filter(call=>call.route==='design-file-delete').length],[200,true,null,deletesBefore],'the refused file is removed in the CRM alone');
 }

 // ---- 4. An older status never replaces a newer one: a pull, a request's send and an approval that answered before a file's answer
 {
  const id=await newRequest();
  await attach(id,'رسم المراجعة.pdf',pdf('revision'));
  const newer=(await server.loadMoldRequest(DB,id)).remote,sales={required:true,sales:{at:'2026-11-02T08:00:00+03:00',by:'مدير المبيعات'},production:null,admin:null};
  const older={...newer,revision:newer.revision-1,approvals:sales},stored=()=>JSON.parse(sql.prepare('SELECT remote FROM crm_mold_requests WHERE id=?').get(id).remote);
  check([newer.revision>1,newer.waitingStep,newer.approvals.sales],[true,'sales',null],'the file\'s answer: a newer revision, the approvals undone');
  const row=await server.loadMoldRequest(DB,id),remoteAt=row.remoteAt;row.remoteAt='2000-01-01T00:00:00.000Z';
  check(await server.pullMoldStatuses(DB,[row],{link,force:true,fetch:stub('status',200,{requests:[older],unknown:[]})}),null,'the pull went through');
  check([stored().revision,stored().approvals.sales,row.remote.revision,row.remote.approvals.sales,sql.prepare('SELECT remote_at FROM crm_mold_requests WHERE id=?').get(id).remote_at],[newer.revision,null,newer.revision,null,remoteAt],'an older pull leaves the newer status, stored and shown');
  sql.prepare("UPDATE crm_mold_requests SET outbox='send',next_attempt_at=? WHERE id=?").run(new Date(Date.now()-1000).toISOString(),id);
  check((await server.sendMoldRequest(DB,id,{link,fetch:stub('requests',200,{request:older,created:false})})).kind,'ok','a change accepted, answered with an older status');
  check([stored().revision,stored().approvals.sales,sql.prepare('SELECT outbox FROM crm_mold_requests WHERE id=?').get(id).outbox],[newer.revision,null,null],'its status does not replace the newer one');
  answering=stub('approval',200,{request:older});
  as('manager');const approved=await json(await requests.POST(post('/api/mold-requests',{action:'approve',requestId:randomUUID(),id})));
  answering=null;
  check([approved.status,stored().revision,stored().approvals.sales,approved.body.request.remote.revision],[200,newer.revision,null,newer.revision],'an approval answered with an older status: the newer one stays');
  const fresh={...newer,revision:newer.revision+1,approvals:sales};
  await server.storeMoldRemote(DB,id,fresh,new Date().toISOString());
  check([stored().revision,stored().approvals.sales.by],[newer.revision+1,'مدير المبيعات'],'a newer answer is stored');
 }

 // ---- 5. Downloads: through the CRM after the read check, and each keeps its place until its body is read or abandoned
 {
  const id=await newRequest(),bytes=pdf('download');
  const fileId=(await attach(id,'رسم التنزيل.pdf',bytes)).body.file.crmFileId;
  mock.addProductionFile(id);
  const row=await server.loadMoldRequest(DB,id);await server.pullMoldStatuses(DB,[row],{link,force:true});
  const production=(await viewOf(id)).designFiles.find(file=>file.source==='production');
  check([production.name,production.state],['تصميم الإنتاج.pdf','production'],'production\'s own file is listed beside the CRM\'s');
  check([(await download('id='+id+'&file='+fileId,'rep2')).status,(await download('id='+id+'&file='+production.fileId,'rep2')).status],[404,404],'a member who may not read the request gets neither');
  const open=[];
  for(let n=1;n<=4;n++){const response=await download('id='+id+'&file='+fileId);check(response.status,200,'the CRM\'s copy, download '+n+' of 4 at once');open.push(response);}
  check([(await download('id='+id+'&file='+production.fileId)).status,(await download('id='+id+'&file='+fileId)).status],[429,429],'four bodies unread (the CRM\'s copies count too): the fifth waits');
  check(Buffer.compare(Buffer.from(await open[0].arrayBuffer()),bytes),0,'a body read to the end: the bytes as attached');
  const passed=await download('id='+id+'&file='+production.fileId+'&inline=1');
  check([passed.status,passed.headers.get('content-type'),/^inline; filename\*=UTF-8''/.test(passed.headers.get('content-disposition'))],[200,'application/pdf',true],'its place is free again: production\'s file comes through the CRM');
  check((await download('id='+id+'&file='+fileId)).status,429,'four unread again');
  await open[1].body.cancel();
  const again=await download('id='+id+'&file='+fileId);
  check(again.status,200,'an abandoned body gives its place back');
  check(Buffer.from(await passed.arrayBuffer()).toString(),'%PDF-1.4 production drawing','production\'s bytes, passed on as they came');
  for(const response of [open[2],open[3],again])await response.body.cancel();
  for(let n=0;n<5;n++)check((await download('id='+id+'&file=nowhere')).status,404,'a file the request does not show: 404, holding no place');
  const four=[];for(let n=0;n<4;n++)four.push(await download('id='+id+'&file='+fileId));
  check(four.map(response=>response.status),[200,200,200,200],'every place came back');
  for(const response of four)await response.body.cancel();
 }

 check(mock.state.calls.every(call=>!JSON.stringify(call.headers).includes(mock.state.secret)),true,'the secret never travels');
 console.log(JSON.stringify({ok:true,checks,scope:'mold design files: stopped and refused deletions, final refusals, revisions, download places',productionDataUsed:false}));
}finally{await mock.stop();sql.close();}
