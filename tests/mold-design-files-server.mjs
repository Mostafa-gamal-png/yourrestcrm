// Mold design files on the server (the contract's addition of 2026-11-02): the real lib/mold-requests-server.ts and the attach, delete,
// resend and download routes, transpiled (no build), on a migrated SQLite and the private object store, against the stand-in production
// API. A deletion that stopped after 24 hours is restarted by resend; a deletion production refuses keeps the file with its reason; a
// refusal without the contract's code (a web server's 400/413) is final and takes none of the 10 places; an older status never replaces
// a newer one (a pull, a request's send, an approval); a download keeps its place until its body is read or abandoned, the CRM's own
// copies too; production's refusals for a file's place (too_many_files, crm_file_id_used, PR #27) are final and shown with their reason.
// Synthetic data only; the shared secret is never printed.
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
import {callProducts} from '../portable/mold-client.mjs';

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

 // ---- 6. A name production lists with half a UTF-16 pair («\ud800» in its JSON): shown without it, and its downloads hold no place
 {
  const id=await newRequest();
  mock.addProductionFile(id,{name:'\ud800رسم الإنتاج.pdf'});
  const row=await server.loadMoldRequest(DB,id);await server.pullMoldStatuses(DB,[row],{link,force:true});
  const listed=(await viewOf(id)).designFiles.find(file=>file.source==='production');
  check([listed.name,listed.name.isWellFormed()],['رسم الإنتاج.pdf',true],'the name as listed, without the lone half');
  const answers=[];
  for(let n=0;n<5;n++){const response=await download('id='+id+'&file='+listed.fileId);answers.push([response.status,response.headers.get('content-disposition')]);await response.body?.cancel();}
  check(answers,Array(5).fill([200,"attachment; filename*=UTF-8''"+encodeURIComponent('رسم الإنتاج.pdf')]),'downloaded each time with a header that can be written (no 500, no place lost)');
  // A status stored before this rule (the raw name kept in the database) is served all the same.
  const stored=JSON.parse(sql.prepare('SELECT remote FROM crm_mold_requests WHERE id=?').get(id).remote);
  stored.designFiles=stored.designFiles.map(file=>({...file,name:'\ud800'+file.name}));
  sql.prepare('UPDATE crm_mold_requests SET remote=? WHERE id=?').run(JSON.stringify(stored),id);
  const old=[];for(let n=0;n<5;n++){const response=await download('id='+id+'&file='+listed.fileId);old.push(response.status);await response.body?.cancel();}
  check(old,[200,200,200,200,200],'a stored name with the lone half: served, every place given back');
 }

 // ---- 7. The sales manager's download by order number needs the pending list as production answers it now
 {
  server.forgetPendingApprovals();
  const manual=mock.registerManual({customerName:'مصنع مسجّل في الإنتاج'}),file=mock.addProductionFile(manual.orderNo,{name:'تصميم الطلب اليدوي.pdf'});
  // The list was had two minutes ago, with the order in it; production then moved the order on.
  const earlier=await server.pullPendingApprovals({link,now:()=>new Date(Date.now()-120_000).toISOString()});
  check(earlier.items.some(item=>item.orderNo===manual.orderNo),true,'the order was waiting when the list was last had');
  mock.removeOrder(manual.orderNo);
  answering=stub('pending',500,{error:{code:'server_error',message:'Unexpected server error.'}});
  let response=await download('order='+manual.orderNo+'&file='+file.fileId,'manager');
  answering=null;
  const failed=await response.json();
  check([response.status,/تعذّر التأكد/.test(failed.error)],[502,true],'production\'s list could not be had: nothing is served on the list kept from before');
  server.forgetPendingApprovals();
  response=await download('order='+manual.orderNo+'&file='+file.fileId,'manager');
  check(response.status,404,'with the list as production answers it now: the order no longer waits, 404');
  const waiting=mock.registerManual({customerName:'مصنع آخر'}),its=mock.addProductionFile(waiting.orderNo,{name:'رسم منتظر.pdf'});
  server.forgetPendingApprovals();
  response=await download('order='+waiting.orderNo+'&file='+its.fileId,'manager');
  check(response.status,200,'an order that waits now: served');await response.body.cancel();
 }

 // ---- 8. A file whose deletion is still on its way to production is not served (the screen offers no link to it)
 {
  const id=await newRequest(),bytes=pdf('wrong customer');
  const fileId=(await attach(id,'رسم عميل آخر.pdf',bytes)).body.file.crmFileId,remoteId=String(JSON.parse(fileRow(fileId).remote_file_id));
  mock.state.down=true;
  const answer=await remove(id,fileId);
  mock.state.down=false;
  check([answer.status,answer.body.request.designFiles.map(file=>file.state)],[200,['deleting']],'deleted while production is unreachable: being deleted');
  const statuses=[];
  for(const member of ['rep','manager'])for(const key of [fileId,remoteId]){const response=await download('id='+id+'&file='+key,member);statuses.push(response.status);await response.body?.cancel();}
  check(statuses,[404,404,404,404],'neither its CRM copy nor production\'s, for the requester or the sales manager');
  sql.prepare('UPDATE crm_mold_design_files SET next_attempt_at=? WHERE id=?').run(new Date(Date.now()-1000).toISOString(),fileId);
  check((await server.sendMoldDesignFile(DB,fileId,{link})).kind,'ok','the deletion reaches production');
 }

 // ---- 9. A 404 from design-files, whatever its body (an application or web server that does not know the route yet, or the contract's
 //  not_found): not tried again by itself, the approval not held, the reason shown, and the requester's resend tries again
 {
  for(const [label,body,type] of [['unknown_route',{error:{code:'unknown_route',message:'Unknown route.'}},'application/json'],['http_404','<html>404 Not Found</html>','text/html'],['not_found',{error:{code:'not_found',message:'No request has this crmRequestId.'}},'application/json']]){
   const id=await newRequest();
   answering=stub('design-files',404,body,type);
   const answer=await attach(id,'رسم '+label+'.pdf',pdf(label));
   answering=null;
   const fileId=answer.body.file.crmFileId,shown=answer.body.file;
   check([answer.status,answer.body.send.kind,shown.state,shown.stopped,shown.error.code,shown.error.http,shown.error.final,fileRow(fileId).next_attempt_at],[200,'not_found','waiting',true,label,404,undefined,null],label+': stopped, not refused for good, with the reason');
   const manager=await viewOf(id,{id:'manager',role:'manager'});
   check([manager.can.approve,(await viewOf(id)).can.resend],[true,true],label+': the sales manager may approve meanwhile; the requester may resend');
   const resent=await resend(id);
   check(resent.status,200,label+': the resend is taken');
   await until(()=>fileRow(fileId).sent_at!==null);
   check([fileRow(fileId).outbox,atProduction(id,fileId)],[null,true],label+': once production takes it, the file arrives');
  }
  // A deletion answered 404 by a web server that does not know the route: production holds nothing there; the deletion is complete.
  const id=await newRequest(),fileId=(await attach(id,'رسم للحذف.pdf',pdf('to delete'))).body.file.crmFileId;
  answering=stub('design-file-delete',404,'<html>404 Not Found</html>','text/html');
  const answer=await remove(id,fileId);
  answering=null;
  check([answer.status,answer.body.send.kind,answer.body.request.designFiles,!!fileRow(fileId).deleted_at,fileRow(fileId).outbox,fileRow(fileId).object_key],[200,'ok',[],true,null,null],'a deletion answered 404 (any body) is complete, not retried for 24 hours');
 }

 // ---- 10. A deletion refused with 409 for a file whose send never got its answer: what production's status lists decides
 {
  // Never reached production (the send failed), then the approvals were completed there: production's 409 does not list it, so the
  // deletion is simply complete (not «delivered» for ever).
  let id=await newRequest();
  mock.state.down=true;
  let fileId=(await attach(id,'لم يصل.pdf',pdf('never arrived'))).body.file.crmFileId;
  mock.state.down=false;
  check([fileRow(fileId).outbox,!!fileRow(fileId).last_attempt_at,fileRow(fileId).sent_at],['send',true,null],'the send failed: waiting, tried once');
  for(const step of ['sales','production','admin'])mock.approve(id,step);
  // Production answers the deletion with 409 and its status (the stand-in would say 404 first; the contract leaves the order open).
  const locked=(await callProducts(link,'status',{ids:[id]})).json.requests[0];
  answering=stub('design-file-delete',409,{error:{code:'request_locked',message:'The request is no longer editable.',details:{request:locked}}});
  let answer=await remove(id,fileId);
  answering=null;
  check([answer.status,answer.body.request.designFiles,answer.body.request.editable,!!fileRow(fileId).deleted_at,fileRow(fileId).object_key,atProduction(id,fileId)],[200,[],false,true,null,false],'production\'s 409 does not list it: deleted, and the request shows production\'s status');
  // The send did arrive (only its answer was lost): production's 409 lists it, so it stays, shown as delivered, with why it was not deleted.
  id=await newRequest();
  answering=(url,init)=>new URL(url).searchParams.get('route')==='design-files'?viaMock(url,init).then(()=>{throw new TypeError('connection reset');}):viaMock(url,init);
  fileId=(await attach(id,'وصل بلا رد.pdf',pdf('arrived, answer lost'))).body.file.crmFileId;
  answering=null;
  check([fileRow(fileId).sent_at,atProduction(id,fileId)],[null,true],'production holds it; the CRM did not hear so');
  for(const step of ['sales','production','admin'])mock.approve(id,step);
  answer=await remove(id,fileId);
  const kept=answer.body.request.designFiles.find(file=>file.crmFileId===fileId);
  check([answer.status,answer.body.ok,answer.body.send.kind,kept.state,kept.error.code,kept.canDelete,!!fileRow(fileId).sent_at,JSON.parse(fileRow(fileId).remote_file_id)],[409,false,'locked','sent','request_locked',false,true,mock.row(id).designFiles[0].fileId],'production holds it: delivered, with the reason, no longer deletable');
 }

 // ---- 11. The delete route against production's design-file-delete: 409 request_locked keeps the file with its reason and the status;
 //  404 (production no longer holds it) completes the deletion
 {
  let id=await newRequest();
  let fileId=(await attach(id,'رسم مقفول.pdf',pdf('locked'))).body.file.crmFileId;
  for(const step of ['sales','production','admin'])mock.approve(id,step);
  let answer=await remove(id,fileId);
  const kept=answer.body.request.designFiles.find(file=>file.crmFileId===fileId);
  check([answer.status,answer.body.ok,answer.body.send.kind,typeof answer.body.error,kept.state,kept.error.code,fileRow(fileId).deleted_at,fileRow(fileId).outbox,!!fileRow(fileId).object_key,atProduction(id,fileId),answer.body.request.remote.status],
   [409,false,'locked','string','sent','request_locked',null,null,true,true,'confirmed'],'409: the file stays as production holds it, with the reason; the request shows production\'s status');
  id=await newRequest();
  fileId=(await attach(id,'رسم أزاله الإنتاج.pdf',pdf('removed there'))).body.file.crmFileId;
  mock.row(id).designFiles=[];
  answer=await remove(id,fileId);
  check([answer.status,answer.body.request.designFiles,!!fileRow(fileId).deleted_at,fileRow(fileId).object_key],[200,[],true,null],'404: already gone there, the deletion completes');
 }

 // ---- 12. Where a file stands: refused stays refused when the link is off; a cancelled request's file is not «sent once production has
 //  the request»; a send stopped after 24 hours says so
 {
  let id=await newRequest();
  answering=stub('design-files',400,{error:{code:'invalid_payload',message:'The file was refused.',fields:['file'],details:{reason:'bad_image'}}});
  const refused=(await attach(id,'صورة تالفة.png',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==','base64'))).body.file;
  answering=null;
  check(refused.state,'rejected','refused while the link is up');
  const offline=lib.moldRequestView(await server.loadMoldRequest(DB,id),{id:'rep',role:'rep'},[],false,await filesOf(id));
  check([offline.designFiles[0].state,offline.designFiles[0].error.reason,lib.moldDesignCount(await server.loadMoldRequest(DB,id),await filesOf(id)).crm],['rejected','bad_image',0],'with the link off: still refused with its reason, and takes no place');
  id=await newRequest();
  mock.state.down=true;
  const waiting=(await attach(id,'قبل الإلغاء.pdf',pdf('before the cancellation'))).body.file;
  mock.state.down=false;
  check(waiting.state,'waiting','waiting to be sent');
  sql.prepare("UPDATE crm_mold_requests SET cancelled_at=?,outbox='cancel',next_attempt_at=NULL WHERE id=?").run(new Date().toISOString(),id);
  const cancelled=(await viewOf(id)).designFiles[0];
  check([cancelled.state,cancelled.stopped],['cancelled',false],'the request was cancelled: not sent, and said so');
  id=await newRequest();
  mock.state.down=true;
  const fileId=(await attach(id,'توقف.pdf',pdf('stopped'))).body.file.crmFileId;
  let clock=Date.now();const at=()=>new Date(clock).toISOString();
  for(let n=0;n<40&&fileRow(fileId).next_attempt_at;n++){clock=Date.parse(fileRow(fileId).next_attempt_at)+1000;await server.sendMoldDesignFile(DB,fileId,{link,now:at});}
  mock.state.down=false;
  const stopped=(await viewOf(id)).designFiles[0];
  check([stopped.state,stopped.stopped,stopped.error.code,(await viewOf(id)).can.resend],['waiting',true,'network',true],'stopped after 24 hours: marked stopped, the resend is the way on');
  sql.prepare('UPDATE crm_mold_design_files SET outbox=NULL,next_attempt_at=NULL WHERE id=?').run(fileId);
 }

 // ---- 13. Production's refusals for a file's place (PR #27: 400 invalid_payload, fields crmFileId, details.reason) from the stand-in:
 //  stored with the reason, shown in words, final (not tried again by itself nor by resend), taking none of the 10 places
 {
  const sends=()=>mock.state.calls.filter(call=>call.route==='design-files').length;
  // too_many_files: production attached 10 files of its own since the CRM last read the request, so the CRM's count let the file in.
  let id=await newRequest();
  for(let n=1;n<=10;n++)mock.addProductionFile(id,{name:'تصميم الإنتاج '+n+'.pdf'});
  let answer=await attach(id,'رسم زائد.pdf',pdf('eleventh'));
  let fileId=answer.body.file.crmFileId;
  check([answer.status,answer.body.send,answer.body.file.state,errorOf(fileId),fileRow(fileId).next_attempt_at,atProduction(id,fileId)],
   [200,{kind:'rejected',code:'invalid_payload',reason:'too_many_files'},'rejected',{code:'invalid_payload',reason:'too_many_files',fields:['crmFileId'],http:400,at:errorOf(fileId).at,final:true},null,false],'too_many_files: refused for good with its reason and field');
  check(lib.moldDesignRefusalText(answer.body.file.error.reason,ar=>ar),'الحد 10 ملفات للطلب (ملفاتك وملفات الإنتاج)','shown in words');
  let before=sends();
  check([(await server.sendDueMoldDesignFiles(DB,{link,limit:5})),(await resend(id)).status,sends(),lib.moldDesignCount(await server.loadMoldRequest(DB,id),await filesOf(id)).crm,(await viewOf(id)).can.resend],[0,409,before,0,false],'not tried again (by the timetable or by resend), and it takes no place');
  // crm_file_id_used: the send arrived but its answer was lost; production then deleted the file, so the retry of the same crmFileId is refused.
  id=await newRequest();
  answering=(url,init)=>new URL(url).searchParams.get('route')==='design-files'?viaMock(url,init).then(()=>{throw new TypeError('connection reset');}):viaMock(url,init);
  fileId=(await attach(id,'وصل ثم حُذف.pdf',pdf('arrived, then deleted there'))).body.file.crmFileId;
  answering=null;
  check([fileRow(fileId).outbox,fileRow(fileId).sent_at,atProduction(id,fileId),errorOf(fileId).code],['send',null,true,'network'],'production holds it; the CRM did not hear so and waits to try again');
  mock.removeFile(fileId);
  sql.prepare('UPDATE crm_mold_design_files SET next_attempt_at=? WHERE id=?').run(new Date(Date.now()-1000).toISOString(),fileId);
  const outcome=await server.sendMoldDesignFile(DB,fileId,{link});
  check([outcome,errorOf(fileId),fileRow(fileId).next_attempt_at,fileRow(fileId).outbox],[{kind:'rejected',code:'invalid_payload',fields:['crmFileId'],reason:'crm_file_id_used'},{code:'invalid_payload',reason:'crm_file_id_used',fields:['crmFileId'],http:400,at:errorOf(fileId).at,final:true},null,'send'],'crm_file_id_used: refused for good with its reason and field');
  const shown=(await viewOf(id)).designFiles.find(file=>file.crmFileId===fileId);
  check([shown.state,shown.canDelete,lib.moldDesignRefusalText(shown.error.reason,ar=>ar)],['rejected',true,'الإنتاج رفض الملف: رقمه مستخدم قبل كده لملف تاني أو لملف اتحذف؛ احذفه وارفعه من جديد'],'shown in words; the requester may delete it and attach it again');
  before=sends();
  check([(await server.sendDueMoldDesignFiles(DB,{link,limit:5})),(await resend(id)).status,sends()],[0,409,before],'not tried again by itself nor by resend');
  const deletes=mock.state.calls.filter(call=>call.route==='design-file-delete').length;
  check([(await remove(id,fileId)).status,!!fileRow(fileId).deleted_at,mock.state.calls.filter(call=>call.route==='design-file-delete').length],[200,true,deletes],'deleted in the CRM alone (production holds nothing of it)');
  answer=await attach(id,'وصل ثم حُذف.pdf',pdf('arrived, then deleted there'));
  check([answer.body.file.state,answer.body.file.crmFileId===fileId,atProduction(id,answer.body.file.crmFileId)],['sent',false,true],'attached again: a new crmFileId, and production takes it');
 }

 check(mock.state.calls.every(call=>!JSON.stringify(call.headers).includes(mock.state.secret)),true,'the secret never travels');
 console.log(JSON.stringify({ok:true,checks,scope:'mold design files: stopped and refused deletions, final refusals, revisions, download places',productionDataUsed:false}));
}finally{await mock.stop();sql.close();}
