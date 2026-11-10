// Mold design files on the server (the contract's addition of 2026-11-02): the real lib/mold-requests-server.ts and the attach, delete,
// resend and download routes, transpiled (no build), on a migrated SQLite and the private object store, against the stand-in production
// API. A deletion that stopped after 24 hours is restarted by resend; a deletion production refuses keeps the file with its reason; a
// refusal without the contract's code (a web server's 400/413) is final and takes none of the 10 places; an older status never replaces
// a newer one (a pull, a request's send, an approval); a download keeps its place until its body is read or abandoned, the CRM's own
// copies too; production's refusals for a file's place (too_many_files, crm_file_id_used, PR #27) are final and shown with their reason;
// a file refused only because its request is cancelled in production is held, and sent once the production manager restores it (2026-11-03).
// Production's second update of 2026-11-03: the CRM learns it from any answer carrying quoteOrPoMissing (kept in crm_settings), takes no
// quotation or PO number or file before it (and holds one saved anyway), sends the files with their category (a PDF or an image, 5 of
// each, the same category on a retry) and downloads a file of any list by its fileId. Since 2026-11-05 no number is taken (one a page
// loaded before sends is refused; a stored one is sent as it is) and a new request, of any role, is kept in the CRM until its first
// quotation or PO file: no call, resend, timetable or restart sends it, kept requests never crowd out the others, the first file
// releases it (the request, then its files in order), and deleting the only one before it went keeps it again. Since 2026-11-08 every
// new request is kept the same way until its first design file of its own (the customer's signature does not count): the quotation's
// file is waited for first, the file that leaves nothing missing releases it, and the hold's SQL agrees with the TypeScript rule on
// generated cases (MOLD_HELD_FOR_SQL against moldHeldFor).
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
import {signatureInput} from '../scripts/lib/signature-png.mjs';

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
 // The representatives are the sales manager's team (2026-11-03: the sales manager sees his own and his team's requests).
 for(const [id,role,scope,supervisor] of [['manager','manager','all',''],['rep','rep','eastern','manager'],['rep2','rep','eastern','manager']])sql.prepare("INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,'الرئيسي',?,?,1,0,?)").run(id,'u-'+id,id+'@yourrest.org','عضو '+id,role,supervisor,scope,now);
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
 const teamMembers=()=>sql.prepare('SELECT id,role,supervisor_id AS supervisorId,region_scope AS regionScope FROM crm_members').all();
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
  as('manager');const approved=await json(await requests.POST(post('/api/mold-requests',{action:'approve',requestId:randomUUID(),id,termsAccepted:true})));
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
  check([shown.state,shown.canDelete,lib.moldDesignRefusalText(shown.error.reason,ar=>ar)],['rejected',true,'رقم الملف مستخدم قبل كده لملف تاني أو لملف اتحذف؛ احذفه وأرفقه من جديد'],'shown in words; the requester may delete it and attach it again');
  before=sends();
  check([(await server.sendDueMoldDesignFiles(DB,{link,limit:5})),(await resend(id)).status,sends()],[0,409,before],'not tried again by itself nor by resend');
  const deletes=mock.state.calls.filter(call=>call.route==='design-file-delete').length;
  check([(await remove(id,fileId)).status,!!fileRow(fileId).deleted_at,mock.state.calls.filter(call=>call.route==='design-file-delete').length],[200,true,deletes],'deleted in the CRM alone (production holds nothing of it)');
  answer=await attach(id,'وصل ثم حُذف.pdf',pdf('arrived, then deleted there'));
  check([answer.body.file.state,answer.body.file.crmFileId===fileId,atProduction(id,answer.body.file.crmFileId)],['sent',false,true],'attached again: a new crmFileId, and production takes it');
 }

 // ---- 14. 2026-11-03: a cancellation is no longer final. A file refused only because its request is cancelled in production (by its
 //  production manager while the file waited, or by the CRM's cancellation arriving first) is not refused for good: it is held while the
 //  request is cancelled (in the CRM, or in production as last known), and goes once the production manager restores the request
 {
  const sends=()=>mock.state.calls.filter(call=>call.route==='design-files').length;
  const due=fileId=>sql.prepare('UPDATE crm_mold_design_files SET next_attempt_at=? WHERE id=?').run(new Date(Date.now()-1000).toISOString(),fileId);
  const pull=async id=>server.pullMoldStatuses(DB,[await server.loadMoldRequest(DB,id)],{link,force:true});
  // (a) production unreachable while the file is attached; meanwhile the production manager cancels the request there
  let id=await newRequest();
  mock.state.down=true;
  let fileId=(await attach(id,'انتظر ثم أُلغي.pdf',pdf('waited, then cancelled there'))).body.file.crmFileId;
  mock.state.down=false;
  mock.remove(id);
  due(fileId);
  let outcome=await server.sendMoldDesignFile(DB,fileId,{link});
  let stored=fileRow(fileId);
  check([outcome,stored.outbox,!!stored.next_attempt_at,errorOf(fileId),JSON.parse(sql.prepare('SELECT remote FROM crm_mold_requests WHERE id=?').get(id).remote).status,atProduction(id,fileId)],
   [{kind:'none',code:'held'},'send',true,null,'cancelled',false],'409 for a request cancelled in production: not refused for good; it waits, and production\'s status is stored');
  let shown=(await viewOf(id)).designFiles[0];
  check([shown.state,shown.stopped],['cancelled',false],'shown as held: the request is cancelled');
  let before=sends();
  due(fileId);
  check([await server.sendDueMoldDesignFiles(DB,{link,limit:5}),await server.sendMoldDesignFile(DB,fileId,{link}),sends()-before],[0,{kind:'none',code:'held'},0],'held while the status stored says cancelled: not sent, by the timetable or directly');
  mock.restore(id);
  await pull(id);
  check((await viewOf(id)).designFiles[0].state,'waiting','restored: it waits to be sent again');
  check([await server.sendDueMoldDesignFiles(DB,{link,limit:5}),fileRow(fileId).outbox,!!fileRow(fileId).sent_at,atProduction(id,fileId),(await viewOf(id)).designFiles[0].state],[1,null,true,true,'sent'],'and goes on the next check, reaching production');
  // (b) the file's send is on its way when the representative cancels; the cancellation reaches production first
  id=await newRequest();
  mock.state.down=true;
  fileId=(await attach(id,'سبقه الإلغاء.pdf',pdf('the cancellation came first'))).body.file.crmFileId;
  mock.state.down=false;
  due(fileId);
  const version=sql.prepare('SELECT version FROM crm_mold_requests WHERE id=?').get(id).version;
  answering=async(url,init)=>{
   if(new URL(url).searchParams.get('route')==='design-files'){answering=null;as('rep');check((await requests.POST(post('/api/mold-requests',{action:'cancel',requestId:randomUUID(),id,version,reason:'العميل اعتذر'}))).status,200,'the representative cancels while the file travels');}
   return viaMock(url,init);
  };
  outcome=await server.sendMoldDesignFile(DB,fileId,{link});
  answering=null;
  stored=fileRow(fileId);
  check([outcome,stored.outbox,!!stored.next_attempt_at,errorOf(fileId),mock.row(id).cancelled,atProduction(id,fileId),(await viewOf(id)).designFiles[0].state],
   [{kind:'none',code:'held'},'send',true,null,true,false,'cancelled'],'409 after the cancellation arrived: held, not refused for good');
  mock.restore(id);
  await pull(id);
  const restored=await server.loadMoldRequest(DB,id);
  check([restored.cancelledAt,restored.lastError?.code,await server.sendDueMoldDesignFiles(DB,{link,limit:5}),atProduction(id,fileId),(await viewOf(id)).designFiles[0].state],[null,'restored',1,true,'sent'],'restored by the production manager: active again, and the file goes');
 }

 // ---- 15. 2026-11-03 (production's second update) as it stands since 2026-11-05: the quotation and PO. Until the CRM knows the update
 //  is live nothing of it is taken or sent (a request or file that carries it waits); it learns it from the first answer of any route
 //  carrying quoteOrPoMissing, kept in crm_settings; then a new request carries no number and waits in the CRM for its quotation's or PO's
 //  file, the files go with their category (a PDF or an image, 5 of each, the same category on a retry), and a file of any list downloads
 //  by its fileId
 {
  const known=()=>sql.prepare("SELECT owner_id AS at FROM crm_settings WHERE id='mold-quote-po'").get()?.at||null,forget=()=>sql.prepare("DELETE FROM crm_settings WHERE id='mold-quote-po'").run();
  const specs={description:'200*400*27.5TH MM OPEN',core:'open',vibrators:2,model:'old',halfBlock:'none',moldWidth:1380,gelbaSize:795,moldNo:'',quantity:1,designUrl:'',notes:''};
  // A representative's new request carries the customer's signature (2026-11-04); customer service's goes without it.
  const create=async(extra,member='rep')=>{as(member);return json(await requests.POST(post('/api/mold-requests',{action:'create',requestId:randomUUID(),customerId:'factory',specs,payment:'cash',...(member==='rep'?{signature:signatureInput()}:{}),...extra})));};
  const list=async(member='rep')=>{as(member);return (await requests.GET(new Request('https://test.invalid/api/mold-requests'))).json();};
  const attachAs=async(id,name,bytes,category,member='rep')=>{const form=new FormData();form.set('requestId',randomUUID());form.set('id',id);if(category)form.set('category',category);form.set('file',new File([bytes],name));as(member);return json(await attacher.POST(new Request('https://test.invalid/api/mold-requests/design-files',{method:'POST',headers:{origin:'https://test.invalid'},body:form})));};
  const lastBody=route=>mock.state.calls.findLast(call=>call.route===route&&call.signed)?.body||'';
  const viewQuote=async id=>(await viewOf(id)).designFiles;
  const dataOf=id=>JSON.parse(sql.prepare('SELECT data FROM crm_mold_requests WHERE id=?').get(id).data);
  const sentFor=(id,route='requests')=>mock.state.calls.filter(call=>call.route===route&&call.signed&&call.body.includes(id));
  // A tiny PNG header (IHDR with its size): enough for the CRM's and production's checks.
  const png=(width,height)=>{const b=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(b,0);b.writeUInt32BE(13,8);b.write('IHDR',12,'latin1');b.writeUInt32BE(width,16);b.writeUInt32BE(height,20);b[24]=8;b[25]=6;return b;};
  check([known(),await server.moldQuotePoSupported(DB),(await list()).quotePo],[null,false,false],'nothing learned yet (the stand-in is the application before its update): the screen asks for nothing');
  // (a) before: no number and no quotation or PO file is taken; a request without them goes exactly as before
  const GONE='رقم عرض السعر ورقم الـ PO اتشالوا من الطلب؛ حدّث الصفحة وأرفق ملف عرض السعر أو الـ PO بدالهم.';
  let answer=await create({quoteNo:'Q-1'});
  check([answer.status,answer.body.error,answer.body.fields,sql.prepare("SELECT COUNT(*) n FROM crm_mold_requests WHERE json_extract(data,'$.quoteNo') IS NOT NULL").get().n],[400,GONE,{quoteNo:GONE},0],'a number (a page loaded before): refused by its field, nothing saved');
  answer=await create({quoteNo:'',poNo:null});
  const before=answer.body.request.id;
  check([answer.status,answer.body.send,answer.body.request.sending.held,Object.hasOwn(dataOf(before),'fileRequired'),dataOf(before).designRequired],[200,{kind:'none',code:'design_file',fields:[]},'design_file',false,true],'without them: saved, no quotation\'s file asked for; kept for its design file (2026-11-08, whatever is known of production)');
  answer=await attachAs(before,'رسم أول.pdf',pdf('before design'));
  check([answer.status,answer.body.file.state,answer.body.request.sending.state,Object.keys(JSON.parse(lastBody('requests'))).join(','),answer.body.request.quotePo],[200,'sent','sent','crmRequestId,requestedAt,customer,salesman,specs,payment',null],'its design file releases it: sent as before (no new key: the marker never travels); production holds it, its status carries nothing of it');
  answer=await attachAs(before,'عرض سعر.pdf',pdf('quote before'),'quote');
  check([answer.status,answer.body.error,sql.prepare("SELECT COUNT(*) n FROM crm_mold_design_files WHERE category<>'design'").get().n],[409,'تطبيق المنتجات لسه ما اتحدّثش لاستقبال ملفات عرض السعر والـ PO؛ حدّث الصفحة.',0],'a quotation file before the update: refused');
  // Held (cannot happen in normal use): a request saved with a number, a quotation file, while the update is unknown
  const heldId='mr-'+randomUUID(),at=new Date().toISOString(),heldData={requestedAt:'2026-11-03T10:00:00+03:00',customer:{crmNumber:27,name:'مصنع تجريبي',address:'الدمام',city:'Damam - الدمام'},salesman:{crmMemberId:'rep',name:'مندوب تجريبي',email:'rep@yourrest.org'},specs,payment:'cash',quoteNo:'Q-HELD'};
  sql.prepare("INSERT INTO crm_mold_requests(id,member_id,customer_id,data,outbox,next_attempt_at,created_by,created_at,updated_at,version) VALUES(?,'rep','factory',?,'send',?,'rep',?,?,1)").run(heldId,JSON.stringify(heldData),at,at,at);
  sql.prepare("INSERT INTO crm_mold_design_files(id,request_id,member_id,name,kind,content_type,size,sha256,object_key,created_at,outbox,next_attempt_at,version,category) VALUES('mdf-held-q',?,'rep','عرض.pdf','pdf','application/pdf',?,'x',?,?,'send',?,1,'quote')").run(before,pdf('held quote').length,'mold-design/held-quote',at,at);
  await objects.put('mold-design/held-quote',pdf('held quote'));
  const sendsBefore=mock.state.calls.filter(call=>['requests','design-files'].includes(call.route)).length;
  check([await server.sendMoldRequest(DB,heldId,{link}),await server.sendMoldDesignFile(DB,'mdf-held-q',{link}),await server.sendDueMoldRequests(DB,{link,limit:20}),mock.state.calls.filter(call=>['requests','design-files'].includes(call.route)).length-sendsBefore],
   [{kind:'none',code:'quote_po_update'},{kind:'none',code:'quote_po_update'},0,0],'held: neither is sent to the older application, by a call or by the timetable');
  check([(await viewOf(heldId)).sending.state,(await viewQuote(before)).find(file=>file.crmFileId==='mdf-held-q').state],['held','update'],'and each says it waits for the products application\'s update');
  // (b) production updates; the CRM learns it from the first answer carrying quoteOrPoMissing, whichever route it came from
  mock.setQuotePo(true);
  const pull=async id=>server.pullMoldStatuses(DB,[await server.loadMoldRequest(DB,id)],{link,force:true});
  await pull(before);
  check([typeof known(),await server.moldQuotePoSupported(DB),(await list()).quotePo],['string',true,true],'a status pull taught it (crm_settings, with when): the screen asks for the numbers now');
  forget();await attachAs(before,'رسم.pdf',pdf('a design file teaches it too'));
  check(!!known(),true,'a design file\'s answer teaches it too');
  forget();as('manager');await requests.POST(post('/api/mold-requests',{action:'approve',requestId:randomUUID(),id:before,termsAccepted:true}));
  check(!!known(),true,'and an approval\'s');
  forget();await server.moldPendingFor({me:{id:'manager',role:'manager',regionScope:'all'},db:DB,members:teamMembers(),regionCustomerIds:new Set()},link,{force:true});
  check(!!known(),true,'and the sales manager\'s waiting list');
  forget();answer=await create({});
  check([answer.status,!!known(),answer.body.request.sending.held,Object.hasOwn(dataOf(answer.body.request.id),'fileRequired')],[200,false,'design_file',false],'a request asked for before the CRM knew: no quotation\'s file asked for, kept for its design file (nothing sent, nothing learned)');
  answer=await attachAs(answer.body.request.id,'رسم.pdf',pdf('teaches by its request'));
  check([answer.status,!!known(),answer.body.request.quotePo],[200,true,{missing:true}],'and a request\'s own send (released by its design file, without a quotation file; production marks it missing, and the view says so)');
  check(await server.noteMoldQuotePo(DB,[{quoteOrPoMissing:false}]),true,'learned again: changes nothing (never unlearned by the CRM)');
  // (c) the held request and file go now, with their number and category
  // The page's own check of what is due (any list opened since) or the timetable sends it.
  await server.sendDueMoldRequests(DB,{link,limit:20});await until(()=>!sql.prepare('SELECT outbox FROM crm_mold_requests WHERE id=?').get(heldId).outbox);
  const heldSent=mock.state.calls.filter(call=>call.route==='requests'&&call.signed&&call.body.includes(heldId)).map(call=>JSON.parse(call.body));
  check([heldSent.length,heldSent[0].quoteNo,(await viewOf(heldId)).sending.state,(await viewOf(heldId)).quotePo],[1,'Q-HELD','sent',{missing:true}],'the held request (asked for before this rule: no file asked) goes once, byte for byte with its number; production counts no number: missing');
  sql.prepare("UPDATE crm_mold_design_files SET next_attempt_at=? WHERE id='mdf-held-q'").run(new Date(Date.now()-1000).toISOString());
  await server.sendDueMoldDesignFiles(DB,{link,limit:5});await until(()=>!fileRow('mdf-held-q').outbox);
  const heldFile=mock.state.calls.filter(call=>call.route==='design-files'&&call.signed&&call.body.includes('mdf-held-q')).map(call=>JSON.parse(call.body));
  check([heldFile.length,heldFile[0].category,(await viewQuote(before)).find(file=>file.crmFileId==='mdf-held-q').state],[1,'quote','sent'],'the held quotation file goes once, with its category');
  // (d) a new request needs a quotation or PO file (2026-11-05): kept in the CRM, sent by nothing, until the first is attached
  const callsNow=()=>mock.state.calls.filter(call=>['requests','design-files'].includes(call.route)).length;
  answer=await create({});
  const kept=answer.body.request.id,signatureId=dataOf(kept).signature.fileId;
  check([answer.status,answer.body.send,[answer.body.request.sending.state,answer.body.request.sending.held],dataOf(kept).fileRequired,sentFor(kept).length,sentFor(kept,'design-files').length,answer.body.request.can.resend,answer.body.request.can.attach],
   [200,{kind:'none',code:'quote_file',fields:[]},['waiting','quote_file'],true,0,0,false,true],'saved (with the customer\'s signature), kept: nothing sent, not even the signature; no resend, the attach action offered');
  check([(await create({poNo:'PO-1'})).body.fields,(await create({quoteNo:'',poNo:''})).status],[{poNo:GONE},200],'a number is refused (a page loaded before); empty ones are none');
  sql.prepare("DELETE FROM crm_mold_requests WHERE id<>? AND json_extract(data,'$.fileRequired') IS 1 AND id NOT IN (SELECT request_id FROM crm_mold_design_files WHERE category<>'design')").run(kept);
  const calls0=callsNow();
  check([await server.sendMoldRequest(DB,kept,{link}),await server.sendDueMoldRequests(DB,{link,limit:20}),await server.sendDueMoldDesignFiles(DB,{link,limit:20}),callsNow()-calls0],[{kind:'none',code:'quote_file'},0,0,0],'neither a call, the timetable nor its files\' timetable sends it (as after a restart: the hold is in the database)');
  as('rep');answer=await json(await requests.POST(post('/api/mold-requests',{action:'resend',requestId:randomUUID(),id:kept})));
  check([answer.status,answer.body.error,callsNow()-calls0],[409,'الطلب بانتظار ملف عرض السعر / الـ PO؛ أرفق الملف ويتبعت الطلب لوحده.',0],'a resend: refused with what to do; nothing sent');
  // The kept requests never crowd out the others: five of them due first, and one asked for before the rule still goes.
  const crowd=[];for(let n=0;n<5;n++)crowd.push((await create({})).body.request.id);
  sql.prepare("UPDATE crm_mold_requests SET next_attempt_at='2026-01-01T00:00:00.000Z' WHERE json_extract(data,'$.fileRequired') IS 1").run();
  const plainId='mr-'+randomUUID(),plainAt=new Date().toISOString(),plainData={requestedAt:'2026-11-04T10:00:00+03:00',customer:{crmNumber:27,name:'مصنع تجريبي',address:'الدمام',city:'Damam - الدمام'},salesman:{crmMemberId:'rep',name:'مندوب تجريبي',email:'rep@yourrest.org'},specs,payment:'cash',quoteNo:'Q-OLD'};
  sql.prepare("INSERT INTO crm_mold_requests(id,member_id,customer_id,data,outbox,next_attempt_at,created_by,created_at,updated_at,version) VALUES(?,'rep','factory',?,'send',?,'rep',?,?,1)").run(plainId,JSON.stringify(plainData),plainAt,plainAt,plainAt);
  check([await server.sendDueMoldRequests(DB,{link,limit:5}),sentFor(plainId).length,JSON.parse(sentFor(plainId)[0].body).quoteNo,crowd.concat(kept).every(id=>!sentFor(id).length)],[1,1,'Q-OLD',true],'five kept requests due first: still the one asked for before this rule goes (with its number, as stored), and none of the kept');
  // Customer service asks too (the owner: every role needs the file), without a signature.
  sql.prepare("INSERT OR IGNORE INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES('cs','u-cs','cs@yourrest.org','خدمة العملاء','customer_service','الرئيسي','','eastern',1,0,?)").run(new Date().toISOString());
  answer=await create({},'cs');
  check([answer.status,answer.body.request.sending.held,sentFor(answer.body.request.id).length,Object.hasOwn(dataOf(answer.body.request.id),'signature')],[200,'quote_file',0,false],'customer service\'s new request waits for its file the same way');
  const serviceKept=answer.body.request.id;
  answer=await attachAs(serviceKept,'PO.pdf',pdf('service po'),'po','cs');
  check([answer.status,answer.body.file.state,answer.body.request.sending.held,sentFor(serviceKept).length],[200,'held','design_file',0],'its PO file: kept still, for its design file now (2026-11-08)');
  answer=await attachAs(serviceKept,'رسم.pdf',pdf('service design'),undefined,'cs');
  check([answer.status,answer.body.file.state,answer.body.request.sending.state,sentFor(serviceKept).length,sentFor(serviceKept,'design-files').length],[200,'sent','sent',1,2],'its design file releases it: the request, then the PO file and the design file');
  // A design file does not release it; the first quotation file does: the request first, then its files oldest first.
  answer=await attachAs(kept,'رسم.pdf',pdf('kept design'));
  check([answer.body.file.state,answer.body.request.sending.held,sentFor(kept).length],['held','quote_file',0],'a design file: kept with it (held), still waiting for the quotation or PO file');
  const order0=mock.state.calls.length;
  answer=await attachAs(kept,'عرض سعر.pdf',pdf('kept quotation'),'quote');
  const released=mock.state.calls.slice(order0).filter(call=>call.signed&&['requests','design-files'].includes(call.route)).map(call=>call.route==='requests'?'request':/"crmFileId":"([^"]+)"/.exec(call.body)[1]);
  const keptFiles=await filesOf(kept);
  check([answer.status,answer.body.file.state,answer.body.request.sending.state,released,keptFiles.map(file=>[file.category,!!file.sentAt])],
   [200,'sent','sent',['request',signatureId,keptFiles[1].id,keptFiles[2].id],[['design',true],['design',true],['quote',true]]],'the first quotation file releases it: the request, then the signature, the design file and the quotation file, in the order attached');
  check([Object.keys(JSON.parse(sentFor(kept)[0].body)).join(','),answer.body.request.quotePo,mock.row(kept).quoteFiles?.length??mock.row(kept).designFiles.filter(file=>file.category==='quote').length],['crmRequestId,requestedAt,customer,salesman,specs,payment',{missing:false},1],'sent without a number (the marker never travels); production holds its quotation file: not missing');
  // Another sender (the timetable, a page's own check) claims the request the moment its first quotation file makes it due: the release
  // waits for that claim's end and then sends the request and its files itself, so the attach's answer shows them sent.
  answer=await create({});
  const raced=answer.body.request.id,racedAt=new Date().toISOString();
  sql.prepare("INSERT INTO crm_mold_design_files(id,request_id,member_id,name,kind,content_type,size,sha256,object_key,created_at,outbox,next_attempt_at,version,category) VALUES('mdf-raced',?,'rep','عرض.pdf','pdf','application/pdf',?,'x','mold-design/raced',?,'send',?,1,'quote')").run(raced,pdf('raced').length,racedAt,racedAt);
  await objects.put('mold-design/raced',pdf('raced'));
  sql.prepare("INSERT INTO crm_mold_design_files(id,request_id,member_id,name,kind,content_type,size,sha256,object_key,created_at,outbox,next_attempt_at,version,category) VALUES('mdf-raced-d',?,'rep','رسم.pdf','pdf','application/pdf',?,'x','mold-design/raced-d',?,'send',?,1,'design')").run(raced,pdf('raced design').length,racedAt,racedAt);
  await objects.put('mold-design/raced-d',pdf('raced design'));
  sql.prepare("UPDATE crm_mold_requests SET mutation_id='other',last_attempt_at=?,next_attempt_at=? WHERE id=?").run(racedAt,new Date(Date.now()+60_000).toISOString(),raced);
  setTimeout(()=>sql.prepare("UPDATE crm_mold_requests SET next_attempt_at=? WHERE id=? AND mutation_id='other'").run(new Date(Date.now()-1000).toISOString(),raced),700);
  const racedRelease=await server.releaseMoldRequest(DB,raced,{link});
  check([racedRelease.outcome.kind,racedRelease.files.get('mdf-raced')?.kind,sentFor(raced).length,sentFor(raced,'design-files').length,!!fileRow('mdf-raced').sent_at],['ok','ok',1,3,true],'claimed by another sender at that moment: the release waits for it, then sends the request, its signature, the quotation file and the design file');
  // A never-sent request whose only quotation file is deleted before it went: kept again.
  answer=await create({});
  const again=answer.body.request.id;
  await attachAs(again,'رسم.pdf',pdf('again design'));
  mock.state.notConfigured=true;
  answer=await attachAs(again,'عرض.pdf',pdf('again'),'quote');
  check([answer.body.request.sending.state,answer.body.file.state,(await server.loadMoldRequest(DB,again)).lastError.code,(await server.loadMoldRequest(DB,again)).lastError.notStored],['waiting','held','not_configured',true],'released, but production refused before storing it (not configured): it waits on the timetable, the file held');
  mock.state.notConfigured=false;
  as('rep');answer=await json(await remover.POST(post('/api/mold-requests/design-files/delete',{requestId:randomUUID(),id:again,fileId:answer.body.file.crmFileId})));
  sql.prepare("UPDATE crm_mold_requests SET next_attempt_at='2026-01-01T00:00:00.000Z' WHERE id=?").run(again);
  check([answer.status,answer.body.request.sending.held,await server.sendDueMoldRequests(DB,{link,limit:20}),sentFor(again).length],[200,'quote_file',0,0],'its only quotation file deleted (never sent: removed in the CRM alone): kept again, not sent by the timetable');
  // (e) files: a quotation's PDF or image, not a drawing; 5 of each; the design files apart; a retry with the same category
  answer=await create({});
  const quoted=answer.body.request.id;
  await attachAs(quoted,'رسم.pdf',pdf('quoted design'));
  answer=await attachAs(quoted,'عرض سعر.pdf',pdf('quotation'),'quote');
  const firstQuote=answer.body.file;
  check([answer.status,firstQuote.state,firstQuote.category,mock.row(quoted).designFiles.find(file=>file.crmFileId===firstQuote.crmFileId).category,Object.hasOwn(JSON.parse(lastBody('requests')),'quoteNo')],[200,'sent','quote','quote',false],'a quotation PDF: releases its request (no number in it) and goes with its category');
  answer=await attachAs(quoted,'رسم.dwg',Buffer.from('AC1027'),'po');
  check([answer.status,answer.body.reason,answer.body.fields.name],[400,'not_document','ملف عرض السعر أو الـ PO لازم يكون PDF أو صورة'],'a drawing as the PO: refused here first (not_document), nothing stored');
  for(let n=2;n<=5;n++)check((await attachAs(quoted,'عرض '+n+'.pdf',pdf('quotation '+n),'quote')).status,200,'quotation file '+n);
  answer=await attachAs(quoted,'عرض 6.pdf',pdf('quotation 6'),'quote');
  check([answer.status,answer.body.error],[409,'الحد 5 ملفات لعرض السعر (ملفاتك وملفات الإنتاج). احذف ملفًا أولًا.'],'a sixth quotation file: refused here');
  check([(await attachAs(quoted,'PO.png',Buffer.from(png(3,3)),'po')).body.file.state,(await attachAs(quoted,'رسم.dwg',Buffer.from('AC1027'))).body.file.state],['sent','sent'],'the PO and the design files have their own places');
  mock.loseNext('design-files');
  answer=await attachAs(quoted,'PO 2.pdf',pdf('po two'),'po');
  const lost=answer.body.file.crmFileId;
  sql.prepare('UPDATE crm_mold_design_files SET next_attempt_at=? WHERE id=?').run(new Date(Date.now()-1000).toISOString(),lost);
  const retried=await server.sendMoldDesignFile(DB,lost,{link});
  check([retried.kind,JSON.parse(lastBody('design-files')).category,mock.state.calls.filter(call=>call.route==='design-files'&&call.body.includes(lost)).length,(await viewQuote(quoted)).find(file=>file.crmFileId===lost).state],['ok','po',2,'sent'],'a retry after a lost answer: the same crmFileId with the same category (200, nothing doubled)');
  // Approvals (2026-11-05): the sales manager approves; a PO file attached since keeps the approval, a design file undoes it.
  as('manager');answer=await json(await requests.POST(post('/api/mold-requests',{action:'approve',requestId:randomUUID(),id:quoted,termsAccepted:true})));
  check([answer.status,!!answer.body.request.remote.approvals.sales],[200,true],'the sales manager approves it');
  answer=await attachAs(quoted,'PO 3.pdf',pdf('po three'),'po');
  check([answer.body.file.state,!!answer.body.request.remote.approvals.sales,answer.body.request.remote.waitingStep,!!(await server.loadMoldRequest(DB,quoted)).remote.approvals.sales],['sent',true,'production',true],'a PO file attached after it: sent, the approval stays (production\'s answer stored as it is)');
  as('rep');answer=await json(await remover.POST(post('/api/mold-requests/design-files/delete',{requestId:randomUUID(),id:quoted,fileId:answer.body.file.crmFileId})));
  check([answer.status,!!answer.body.request.remote.approvals.sales],[200,true],'and deleted again: the approval stays');
  // (f) production's files: production attaches its own PO; downloads by fileId; the numbers it holds are not shown
  mock.setNumbers(quoted,{poNo:'PO-7781',quoteNo:'Q-2026-0153-B'});
  const ownPo=mock.addProductionFile(quoted,{name:'PO من الإنتاج.pdf',category:'po'});
  await pull(quoted);
  const shown=await viewOf(quoted),theirs=shown.designFiles.find(file=>file.fileId===String(ownPo.fileId));
  check([shown.quotePo,theirs.category,theirs.source,theirs.state],[{missing:false},'po','production','production'],'production\'s own PO file on the request; its flag, not its numbers');
  let file=await download('id='+quoted+'&file='+ownPo.fileId);
  check([file.status,Buffer.from(await file.arrayBuffer()).toString().startsWith('%PDF')],[200,true],'production\'s PO file downloads through the CRM by its fileId');
  // The request released above still waits for the sales manager (the one approved here no longer does).
  const quoteFileId=mock.row(kept).designFiles.find(entry=>entry.category==='quote').fileId;
  file=await download('order='+mock.row(kept).orderNo+'&file='+quoteFileId,'manager');
  check([file.status,Buffer.from(await file.arrayBuffer()).equals(pdf('kept quotation'))],[200,true],'the sales manager downloads a quotation file from the waiting list by its fileId (quoteFiles)');
  const pending=await server.moldPendingFor({me:{id:'manager',role:'manager',regionScope:'all'},db:DB,members:teamMembers(),regionCustomerIds:new Set()},link,{force:true}),item=pending.items.find(entry=>entry.crmRequestId===kept);
  // The CRM's request is linked by its crmRequestId (2026-11-05, the second update: an order number names nothing); ?order= above, as a
  // page loaded before links it, still works for a numbered item.
  check([item.quoteOrPoMissing,item.quoteFiles.length,item.designFiles.length,item.quoteFiles[0].href.startsWith('/api/mold-requests/design-file?crm='+kept+'&file=')],[false,1,2,true],'the waiting list: the released request with its quotation file (each list with its link, by its crmRequestId), not missing');
  file=await download(item.quoteFiles[0].href.split('?')[1],'manager');
  check([file.status,Buffer.from(await file.arrayBuffer()).equals(pdf('kept quotation'))],[200,true],'the link as listed (crm=) downloads the same file');
  mock.setQuotePo(false);
 }

 // ---- 2026-11-08: every new request is kept until its first design file of its own (the customer's signature does not count), sent by
 // nothing meanwhile; the design file releases it (the request, then its files in order); deleting the only one before it went keeps it
 // again. Then the hold's SQL against the TypeScript rule on generated cases.
 {
  sql.prepare("DELETE FROM crm_settings WHERE id='mold-quote-po'").run();
  const specs={description:'200*400*27.5TH MM OPEN',core:'open',vibrators:2,model:'old',halfBlock:'none',moldWidth:1380,gelbaSize:795,moldNo:'',quantity:1,designUrl:'',notes:''};
  const create=async(member='rep')=>{as(member);return json(await requests.POST(post('/api/mold-requests',{action:'create',requestId:randomUUID(),customerId:'factory',specs,payment:'cash',...(member==='rep'?{signature:signatureInput()}:{})})));};
  const attachAs=async(id,name,bytes,category,member='rep')=>{const form=new FormData();form.set('requestId',randomUUID());form.set('id',id);if(category)form.set('category',category);form.set('file',new File([bytes],name));as(member);return json(await attacher.POST(new Request('https://test.invalid/api/mold-requests/design-files',{method:'POST',headers:{origin:'https://test.invalid'},body:form})));};
  const dataOf=id=>JSON.parse(sql.prepare('SELECT data FROM crm_mold_requests WHERE id=?').get(id).data);
  const sentFor=(id,route='requests')=>mock.state.calls.filter(call=>call.route===route&&call.signed&&call.body.includes(id));
  const callsNow=()=>mock.state.calls.filter(call=>['requests','design-files'].includes(call.route)).length;
  let answer=await create();
  const kept=answer.body.request.id,signatureId=dataOf(kept).signature.fileId;
  check([answer.status,answer.body.send,[answer.body.request.sending.state,answer.body.request.sending.held],dataOf(kept).designRequired,Object.hasOwn(dataOf(kept),'fileRequired'),sentFor(kept).length,sentFor(kept,'design-files').length,answer.body.request.can.resend,answer.body.request.can.attach,answer.body.request.designRequired],
   [200,{kind:'none',code:'design_file',fields:[]},['waiting','design_file'],true,false,0,0,false,true,true],'saved with the customer\'s signature (a design file, not counted), kept: nothing sent, not even the signature; no resend, the attach action');
  sql.prepare("UPDATE crm_mold_requests SET next_attempt_at='2026-01-01T00:00:00.000Z' WHERE id=?").run(kept);
  const calls0=callsNow();
  check([await server.sendMoldRequest(DB,kept,{link}),await server.sendDueMoldRequests(DB,{link,limit:20}),await server.sendDueMoldDesignFiles(DB,{link,limit:20}),callsNow()-calls0],[{kind:'none',code:'design_file'},0,0,0],'due: neither a call, the timetable nor its files\' timetable sends it (the hold is in the database)');
  as('rep');answer=await json(await requests.POST(post('/api/mold-requests',{action:'resend',requestId:randomUUID(),id:kept})));
  check([answer.status,answer.body.error,callsNow()-calls0],[409,'الطلب بانتظار ملف التصميم؛ أرفق ملف تصميم ويتبعت الطلب لوحده.',0],'a resend: refused with what to do; nothing sent');
  const order0=mock.state.calls.length;
  answer=await attachAs(kept,'رسم القالب.pdf',pdf('kept design 2026-11-08'));
  const released=mock.state.calls.slice(order0).filter(call=>call.signed&&['requests','design-files'].includes(call.route)).map(call=>call.route==='requests'?'request':/"crmFileId":"([^"]+)"/.exec(call.body)[1]);
  check([answer.status,answer.body.file.state,answer.body.request.sending.state,answer.body.request.sending.held??null,released,Object.keys(JSON.parse(sentFor(kept)[0].body)).join(',')],
   [200,'sent','sent',null,['request',signatureId,answer.body.file.crmFileId],'crmRequestId,requestedAt,customer,salesman,specs,payment'],'its design file releases it: the request (no marker in it), then the signature, then the design file');
  // Customer service asks the same way (the owner: every role), without a signature; a design file that will not reach production
  // (production refused the request before storing it) and is deleted before it went: kept again.
  answer=await create('cs');
  const again=answer.body.request.id;
  check([answer.body.request.sending.held,Object.hasOwn(dataOf(again),'signature')],['design_file',false],'customer service\'s new request waits for its design file too');
  mock.state.notConfigured=true;
  answer=await attachAs(again,'رسم.pdf',pdf('again 2026-11-08'),undefined,'cs');
  check([answer.body.request.sending.state,answer.body.request.sending.held??null,answer.body.file.state,(await server.loadMoldRequest(DB,again)).lastError.notStored],['waiting',null,'held',true],'released, but production refused before storing it: it waits on the timetable, the file held');
  mock.state.notConfigured=false;
  as('cs');answer=await json(await remover.POST(post('/api/mold-requests/design-files/delete',{requestId:randomUUID(),id:again,fileId:answer.body.file.crmFileId})));
  sql.prepare("UPDATE crm_mold_requests SET next_attempt_at='2026-01-01T00:00:00.000Z' WHERE id=?").run(again);
  check([answer.status,answer.body.request.sending.held,await server.sendDueMoldRequests(DB,{link,limit:20}),sentFor(again).length],[200,'design_file',0,0],'its only design file deleted (never sent: removed in the CRM alone): kept again, not sent by the timetable');
  // The SQL (MOLD_HELD_FOR_SQL, MOLD_AWAITS_FILE_SQL) and the TypeScript rule (moldHeldFor) agree on every generated case.
  const base={requestedAt:'2026-11-08T10:00:00+03:00',customer:{crmNumber:27,name:'مصنع تجريبي',address:'الدمام',city:'Damam - الدمام'},salesman:{crmMemberId:'rep',name:'مندوب تجريبي',email:'rep@yourrest.org'},specs,payment:'cash'};
  const t0='2026-11-08T08:00:00.000Z',t1='2026-11-08T08:00:05.000Z';
  const states={fresh:{},accepted:{outbox:null,accepted:true},cancel:{outbox:'cancel'},maybe:{last_attempt_at:t0,last_error:{code:'timeout',http:0,at:t1}},notStored:{last_attempt_at:t0,last_error:{code:'invalid_payload',http:400,at:t1,notStored:true}},remote:{remote:{crmRequestId:'x',status:'received'}}};
  const kinds={signature:{category:'design',signature:true},design:{category:'design'},designDeleted:{category:'design',deleted_at:t0,outbox:null},designDeleting:{category:'design',deleted_at:t0,outbox:'delete'},designRefused:{category:'design',next_attempt_at:null,last_attempt_at:t0,last_error:{code:'x',http:400,at:t1,final:true}},
   designStopped:{category:'design',next_attempt_at:null,last_attempt_at:t0,last_error:{code:'network',http:0,at:t1}},designSent:{category:'design',outbox:null,sent_at:t1},quote:{category:'quote'},poRefused:{category:'po',next_attempt_at:null,last_attempt_at:t0,last_error:{code:'x',http:400,at:t1,final:true}},quoteDeleted:{category:'quote',deleted_at:t0,outbox:null}};
  let seed=20261108;const random=()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;
  const cases=[],tally={};
  for(let n=0;n<500;n++){
   // 2026-11-10: a request waiting for the customer's signature from a link (customer_signature, after the files' reasons).
   const marks={fileRequired:random()<0.5,designRequired:random()<0.7,signed:random()<0.5,awaits:random()<0.5},state=Object.keys(states)[Math.floor(random()*Object.keys(states).length)];
   const files=Object.keys(kinds).filter(()=>random()<0.25);
   cases.push({marks,state,files});
  }
  for(const [n,{marks,state,files}] of cases.entries()){
   const id='mr-'+randomUUID(),change=states[state],signature=marks.signed?{signer:'خالد',signedAt:t0,fileId:'mds-gen-'+n}:null;
   const data={...base,...(marks.fileRequired?{fileRequired:true}:{}),...(marks.designRequired?{designRequired:true}:{}),...(signature?{signature}:{}),...(marks.awaits?{awaitsSignature:true}:{})};
   sql.prepare("INSERT INTO crm_mold_requests(id,member_id,customer_id,data,accepted,outbox,next_attempt_at,last_attempt_at,last_error,remote,created_by,created_at,updated_at,version) VALUES(?,'rep','factory',?,?,?,?,?,?,?,'rep',?,?,1)")
    .run(id,JSON.stringify(data),change.accepted?JSON.stringify(data):null,'outbox' in change?change.outbox:'send',t0,change.last_attempt_at||null,change.last_error?JSON.stringify(change.last_error):null,change.remote?JSON.stringify(change.remote):null,t0,t0);
   for(const kind of files){
    const file=kinds[kind],fileId=file.signature?(signature?signature.fileId:'mds-unnamed-'+n):'mdf-gen-'+n+'-'+kind;
    sql.prepare("INSERT INTO crm_mold_design_files(id,request_id,member_id,name,kind,content_type,size,sha256,object_key,created_at,deleted_at,outbox,next_attempt_at,last_attempt_at,last_error,sent_at,version,category) VALUES(?,?,'rep','f.pdf','pdf','application/pdf',1,'x','k',?,?,?,?,?,?,?,1,?)")
     .run(fileId,id,t0,file.deleted_at||null,'outbox' in file?file.outbox:'send','next_attempt_at' in file?file.next_attempt_at:t0,file.last_attempt_at||null,file.last_error?JSON.stringify(file.last_error):null,file.sent_at||null,file.category);
   }
   const fromSql=sql.prepare(`SELECT ${server.MOLD_HELD_FOR_SQL()} AS held,${server.MOLD_AWAITS_FILE_SQL()} AS awaits FROM crm_mold_requests WHERE id=?`).get(id);
   const fromTs=lib.moldHeldFor(await server.loadMoldRequest(DB,id),await filesOf(id));
   assert.deepEqual([fromSql.held,fromSql.awaits],[fromTs,fromTs?1:0],'case '+n+': '+JSON.stringify({marks,state,files}));
   tally[String(fromTs)]=(tally[String(fromTs)]||0)+1;
   sql.prepare('DELETE FROM crm_mold_requests WHERE id=?').run(id);
  }
  check([Object.keys(tally).sort(),Object.values(tally).every(count=>count>=20)],[['customer_signature','design_file','null','quote_file'],true],'the SQL and the TypeScript rule agree on '+cases.length+' generated cases, each reason well represented');
 }

 // ---- 2026-11-05 (the second update's review): a request's files reach production in the order they were attached, whichever sender
 // runs (the timetable or a page's check beside an upload's release): a newer file waits while an older one is due or being sent
 {
  const id=await newRequest();
  mock.state.down=true;
  const older=(await attach(id,'الأقدم.pdf',pdf('older'))).body.file.crmFileId,newer=(await attach(id,'الأحدث.pdf',pdf('newer'))).body.file.crmFileId;
  mock.state.down=false;
  const set=(fileId,next,last=null)=>sql.prepare('UPDATE crm_mold_design_files SET next_attempt_at=?,last_attempt_at=? WHERE id=?').run(next,last,fileId);
  const past=new Date(Date.now()-60_000).toISOString(),soon=new Date(Date.now()+60_000).toISOString(),later=new Date(Date.now()+10*60_000).toISOString();
  // The older one claimed by another sender (its lease ahead), the newer one due: the newer waits.
  set(older,soon,new Date().toISOString());set(newer,past);
  check([await server.sendDueMoldDesignFiles(DB,{link,limit:5}),atProduction(id,newer)],[0,false],'a newer file waits while an older one of the request is being sent');
  // Both due: oldest first, in one check.
  set(older,past);
  check([await server.sendDueMoldDesignFiles(DB,{link,limit:5}),mock.row(id).designFiles.map(file=>file.crmFileId)],[2,[older,newer]],'then both, in the order attached');
  // An older file that stopped (no next try) or retries later than a lease holds none.
  mock.state.down=true;
  const stopped=(await attach(id,'متوقف.pdf',pdf('stopped'))).body.file.crmFileId,afterStopped=(await attach(id,'بعده.pdf',pdf('after stopped'))).body.file.crmFileId;
  const backoff=(await attach(id,'مؤجل.pdf',pdf('backoff'))).body.file.crmFileId,afterBackoff=(await attach(id,'بعد المؤجل.pdf',pdf('after backoff'))).body.file.crmFileId;
  mock.state.down=false;
  set(stopped,null);set(afterStopped,past);set(backoff,later);set(afterBackoff,past);
  check([await server.sendDueMoldDesignFiles(DB,{link,limit:5}),atProduction(id,afterStopped),atProduction(id,afterBackoff),atProduction(id,stopped),atProduction(id,backoff)],[2,true,true,false,false],'a stopped file, or one retrying after more than a lease, holds no newer file back');
 }

 // ---- a pending item production sent that cannot be read (a request registered there with a malformed requestRef and no number) is
 // counted, not dropped silently; a page loaded before gets the list's error for it
 {
  const good={orderNo:null,requestRef:'0f8e2c1a-5b7d-4c3e-9a1f-2b3c4d5e6f70',crmRequestId:null,source:'manual',customer:{name:'مقروء'},salesman:{name:'س'},specs:{description:'d'}};
  answering=stub('pending',200,{requests:[good,{...good,requestRef:'not-a-uuid'}]});
  const pending=await server.moldPendingFor({me:{id:'manager',role:'manager',regionScope:'all'},db:DB,members:teamMembers(),regionCustomerIds:new Set()},link,{force:true});
  answering=null;
  check([pending.items.map(item=>item.customer.name),pending.unreadable,pending.error],[['مقروء'],1,null],'one item read, one counted as unreadable');
  check(lib.moldPendingForOldPage({...pending,items:[]}).error.code,'bad_response','a page loaded before: the list error');
  server.forgetPendingApprovals();
 }

 check(mock.state.calls.every(call=>!JSON.stringify(call.headers).includes(mock.state.secret)),true,'the secret never travels');
 console.log(JSON.stringify({ok:true,checks,scope:'mold design files: stopped and refused deletions, final refusals, revisions, download places',productionDataUsed:false}));
}finally{await mock.stop();sql.close();}
