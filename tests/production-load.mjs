// Reproducible, local-only workload against the actual built Namecheap release.
// Synthetic private SQLite and pre-issued test sessions; no email or live-host access.
// YR_LOAD_USERS=30 YR_LOAD_HISTORY=24000 YR_LOAD_SECONDS=60 YR_LOAD_INTERVAL_MS=2000
// YR_LOAD_OUTPUT=/absolute/path/result.json node tests/production-load.mjs
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {request as httpRequest,Agent} from 'node:http';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {mkdtemp,mkdir,readFile,readdir,writeFile,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHmac,createHash,randomBytes,randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {sqliteDatabase} from '../portable/storage.mjs';

// Synthetic capture times must stay inside company hours even when the local
// workload is run at night. Real elapsed time/latency use performance.now().
// Apply the same test-only offset to the fixture and spawned built server.
const RealDate=Date,clockOffset=RealDate.parse(new RealDate().toISOString().slice(0,10)+'T09:00:00.000Z')-RealDate.now();
globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[RealDate.now()+clockOffset]));}static now(){return RealDate.now()+clockOffset;}};
process.on('exit',()=>{globalThis.Date=RealDate;});

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const release=path.join(root,'dist/standalone'),origin='https://crm.yourrest.org';
const integer=(name,fallback,min,max)=>{const n=Number(process.env[name]??fallback);assert(Number.isInteger(n)&&n>=min&&n<=max,`${name} must be ${min}..${max}`);return n;};
const users=integer('YR_LOAD_USERS',30,2,200),history=integer('YR_LOAD_HISTORY',24000,0,500000);
const seconds=integer('YR_LOAD_SECONDS',60,1,3600),interval=integer('YR_LOAD_INTERVAL_MS',2000,0,60000);
const factoriesPerRep=20,output=process.env.YR_LOAD_OUTPUT;
if(output)assert(path.isAbsolute(output),'YR_LOAD_OUTPUT must be absolute');
const work=await mkdtemp(path.join(os.tmpdir(),'yourrest-load-'));
const clockPreload=path.join(work,'scenario-clock.mjs');
await writeFile(clockPreload,`const RealDate=Date;const offset=${clockOffset};globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[RealDate.now()+offset]));}static now(){return RealDate.now()+offset;}};`);
const data=path.join(work,'data'),filename=path.join(data,'database.sqlite');
const cgroupCpu=await readFile('/sys/fs/cgroup/cpu.max','utf8').then(x=>x.trim()).catch(()=>null),cgroupMemory=await readFile('/sys/fs/cgroup/memory.max','utf8').then(x=>x.trim()).catch(()=>null);
const builtServerSha256=createHash('sha256').update(await readFile(path.join(release,'dist/server/index.js'))).digest('hex');
// A custom Node Agent has no idle timeout by default. Give it a nonzero timeout
// so Node honors the server Keep-Alive hint (5s minus its 1s safety buffer).
// Active requests still use their separate 30s timeout. Never retry failed I/O.
const secret=randomBytes(32).toString('hex'),agent=new Agent({keepAlive:true,maxSockets:users+4,timeout:5000});
const metrics=new Map(),errors=[],expectedPoints=new Map(),expectedVisits=new Map();
const socketHistory=new WeakMap();
let child,db,log='',port,startedAt,finishedAt,peakRssKiB=0,memoryTimer,processStatus;
let crmIsolationChecks=0,gpsIsolationChecks=0,denialChecks=0,pointReplays=0,visitReplays=0;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const reps=Array.from({length:users},(_,index)=>({id:`load-rep-${index}`,index,branch:index%2?'West':'East',region:index%2?'western':'eastern',label:index%2?'الغربية':'الشرقية',deviceId:randomUUID(),customerId:`load-customer-${index}-0`,customerVersion:1,cycles:0}));
async function request(url,{member,method='GET',body,measure}={}){
 const bytes=body===undefined?undefined:Buffer.from(JSON.stringify(body));
 const headers={Host:'crm.yourrest.org','X-Forwarded-Proto':'https',...(member?{Cookie:member.cookie}:{}),...(bytes?{Origin:origin,'Content-Type':'application/json','Content-Length':String(bytes.length)}:{})};
 const start=performance.now();let status=0,responseBytes=0;
 try{return await new Promise((resolve,reject)=>{
  let socketRecord,assignedAt,prior;
  const req=httpRequest({host:'127.0.0.1',port,path:url,method,headers,agent,timeout:30000},res=>{const chunks=[];status=res.statusCode;res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);res.on('end',()=>{if(socketRecord){socketRecord.lastResponseAt=performance.now();socketRecord.headers={connection:res.headers.connection,keepAlive:res.headers['keep-alive']};socketRecord.path=url;}const raw=Buffer.concat(chunks);responseBytes=raw.length;let json;try{json=JSON.parse(raw.toString());}catch{}resolve({status,json,text:raw.toString()});});});
  req.on('socket',socket=>{assignedAt=performance.now();socketRecord=socketHistory.get(socket);if(!socketRecord){socketRecord={createdAt:assignedAt};socketHistory.set(socket,socketRecord);socket.on('end',()=>{socketRecord.remoteEndedAt=performance.now();});socket.on('close',hadError=>{socketRecord.closedAt=performance.now();socketRecord.hadError=hadError;});}prior={...socketRecord};});
  req.on('error',error=>{error.transport={code:error.code,reusedSocket:req.reusedSocket,path:url,method,socketAgeMs:socketRecord?Math.round(performance.now()-socketRecord.createdAt):null,idleBeforeRequestMs:prior?.lastResponseAt?Math.round(assignedAt-prior.lastResponseAt):null,previousHeaders:prior?.headers,previousPath:prior?.path,remoteEndedBeforeRequest:!!prior?.remoteEndedAt,remoteEndAfterAssignmentMs:socketRecord?.remoteEndedAt?Math.round(socketRecord.remoteEndedAt-assignedAt):null,socketDestroyed:req.socket?.destroyed};reject(error);});req.on('timeout',()=>req.destroy(Error('Request exceeded 30 seconds')));req.end(bytes);
 });}finally{if(measure){const item=metrics.get(measure)||{latencies:[],statuses:{},bytes:0};item.latencies.push(performance.now()-start);item.statuses[status]=(item.statuses[status]||0)+1;item.bytes+=responseBytes;metrics.set(measure,item);}}
}
function accepted(response){assert.equal(response.status,200,`HTTP ${response.status}: ${response.text.slice(0,400)}`);assert(response.json,'Expected JSON');return response.json;}
function checkCrm(payload,rep){
 assert.equal(payload.me.id,rep.id,'Wrong signed-in identity');
 for(const record of payload.records){
  if(record.kind==='customer')assert.equal(record.data.region,rep.label,'Cross-region factory leaked');
  else if(record.kind==='activity')assert.equal(record.data.performedBy,rep.id,'Another representative activity leaked');
 }
 const factory=payload.records.find(row=>row.id===rep.customerId);assert(factory,'Own factory missing');rep.customerVersion=factory.version;crmIsolationChecks++;
}
function visitBody(rep){return {createKey:randomUUID(),customerId:rep.customerId,customerVersion:rep.customerVersion,timingMode:'automatic',elapsedMilliseconds:5000,data:{type:'call',summary:'Synthetic production-load follow-up',result:'Customer requested a follow-up',outcome:'followup',salesStage:'new',strength:'medium',nextAction:'Call factory',nextDate:day(),location:rep.region==='western'?'21.5, 39.2':'26.43, 50.03',locationSource:'device',locationCapturedAt:new Date().toISOString(),locationAccuracy:10}};}
async function worker(rep,end){
 await pause(rep.index*Math.max(1,Math.floor(interval/users)));
 while(performance.now()<end){const cycleStart=performance.now();
  try{
   const capturedAt=new Date().toISOString(),point={id:randomUUID(),capturedAt,latitude:rep.region==='western'?21.5:26.43,longitude:(rep.region==='western'?39.2:50.03)+(rep.cycles%10)*0.00001,accuracy:10,stopId:null};
   const body={action:'samples',dayId:rep.dayId,deviceId:rep.deviceId,points:[point]};
   // Track submissions as well as acknowledgements: ambiguous network errors must
   // fail the run, never silently count as successful delivery.
   expectedPoints.set(point.id,{dayId:rep.dayId,memberId:rep.id,point,acknowledged:false});
   const gps=accepted(await request('/api/mobile-route',{member:rep,method:'POST',body,measure:'gpsSample'}));
   assert.equal(gps.memberId,rep.id);assert.equal(gps.day.id,rep.dayId);assert.deepEqual(gps.acknowledgedIds,[point.id]);gpsIsolationChecks++;expectedPoints.get(point.id).acknowledged=true;
   if(rep.cycles%10===0){const replay=accepted(await request('/api/mobile-route',{member:rep,method:'POST',body,measure:'gpsReplay'}));assert.deepEqual(replay.acknowledgedIds,[point.id]);pointReplays++;}
   if(rep.cycles%3===0)checkCrm(accepted(await request('/api/crm',{member:rep,measure:'crmRead'})),rep);
   if(rep.cycles%5===0){
    const body=visitBody(rep),saved=accepted(await request('/api/visits',{member:rep,method:'POST',body,measure:'visitSave'}));
    assert.equal(saved.id,'customer-visit-'+body.createKey);assert(!saved.alreadySaved);expectedVisits.set(saved.id,{memberId:rep.id,customerId:rep.customerId,key:body.createKey,summary:body.data.summary});rep.customerVersion++;
    const replay=accepted(await request('/api/visits',{member:rep,method:'POST',body,measure:'visitReplay'}));assert.equal(replay.id,saved.id);assert.equal(replay.alreadySaved,true);visitReplays++;
   }
   rep.cycles++;
  }catch(error){if(errors.length<30)errors.push({member:rep.id,cycle:rep.cycles,message:error.message,...(error.transport?{transport:error.transport}:{})});break;}
  await pause(Math.max(0,interval-(performance.now()-cycleStart)));
 }
}
function summaries(){return Object.fromEntries([...metrics].map(([name,item])=>{const values=[...item.latencies].sort((a,b)=>a-b),q=p=>Math.round(values[Math.max(0,Math.ceil(values.length*p)-1)]*100)/100;return [name,{count:values.length,p50Ms:q(.5),p95Ms:q(.95),p99Ms:q(.99),maxMs:q(1),statuses:item.statuses,responseBytes:item.bytes}];}));}
let report;
try{
 await stat(path.join(release,'server.js'));await mkdir(data,{mode:0o700});await mkdir(path.join(data,'objects'),{mode:0o700});
 db=sqliteDatabase(filename,{create:true});await db.exec('CREATE TABLE yr_schema_migrations(name TEXT PRIMARY KEY NOT NULL,sha256 TEXT NOT NULL,applied_at TEXT NOT NULL)');
 for(const migration of (await readdir(path.join(root,'drizzle'))).filter(name=>/^\d+.*\.sql$/.test(name)).sort()){const sql=await readFile(path.join(root,'drizzle',migration),'utf8');await db.exec(sql);await db.prepare('INSERT INTO yr_schema_migrations VALUES(?,?,?)').bind(migration,createHash('sha256').update(sql).digest('hex'),new Date().toISOString()).run();}
 const seededAt=new Date().toISOString(),historicalAt=new Date(Date.now()-86400000).toISOString();
 const sql=db.connection;sql.exec('BEGIN IMMEDIATE');
 try{
  const member=sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,active,target,created_at,region_scope) VALUES(?,?,?,?,?,?,1,0,?,?)');
  const session=sql.prepare('INSERT INTO auth_sessions(token_hash,user_id,user_version,email,challenge_id,created_at,expires_at) VALUES(?,?,1,?,?,?,0)');
  const record=sql.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)');
  member.run('owner','opaque-load-owner','load.owner@yourrest.org','Synthetic owner','admin','Main',seededAt,'all');
  sql.prepare('INSERT INTO crm_settings(id,owner_id) VALUES(?,?)').run('company','opaque-load-owner');
  for(const rep of reps){
   const token=randomBytes(32).toString('hex'),email=rep.id+'@yourrest.org';rep.cookie='__Host-yourrest_session='+token;
   member.run(rep.id,'opaque-'+rep.id,email,'Synthetic '+rep.id,'rep',rep.branch,seededAt,rep.region);
   session.run(createHmac('sha256',Buffer.from(secret)).update('session:'+token).digest('hex'),rep.id,email,randomUUID(),Date.now());
   for(let i=0;i<factoriesPerRep;i++){const id=`load-customer-${rep.index}-${i}`;record.run(id,'customer',null,rep.id,rep.branch,JSON.stringify({name:'Synthetic factory '+id,code:id,region:rep.label,city:rep.branch,assignedTo:rep.id,branch:rep.branch,location:rep.region==='western'?'21.5, 39.2':'26.43, 50.03'}),historicalAt,historicalAt);}
  }
  for(let i=0;i<history;i++){const rep=reps[i%users];record.run('load-history-'+i,'activity',`load-customer-${rep.index}-${Math.floor(i/users)%factoriesPerRep}`,rep.id,rep.branch,JSON.stringify({visitWorkflow:'customer-v1',type:'visit',summary:'Synthetic historical factory visit '+i,result:'Follow-up',outcome:'followup',performedBy:rep.id,responsibleId:rep.id,date:historicalAt.slice(0,10),recordedByEmail:rep.id+'@yourrest.org',salesStage:'new',strength:'medium',nextAction:'Call factory',nextDate:day(),startedAt:historicalAt,endedAt:historicalAt,notes:'Synthetic fixture for scaled history. '.repeat(8)}),historicalAt,historicalAt);}
  sql.exec('COMMIT');
 }catch(error){sql.exec('ROLLBACK');throw error;}
 const listener=createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
 child=spawn(process.execPath,['--import',clockPreload,'app.cjs'],{cwd:release,env:{PATH:process.env.PATH,NODE_ENV:'production',PORT:String(port),HOST:'127.0.0.1',YR_APP_ORIGIN:origin,YR_AUTH_SECRET:secret,YR_DATABASE_PATH:filename,YR_OBJECTS_PATH:path.join(data,'objects'),YR_MAIL_TRANSPORT:'sendmail',YR_MAIL_FROM:'noreply@yourrest.org',YR_SENDMAIL_PATH:'/bin/false'},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',part=>log=(log+part).slice(-12000));child.stderr.on('data',part=>log=(log+part).slice(-12000));
 let ready=false;for(let n=0;n<100;n++){if(child.exitCode!==null)throw Error('Built server exited');try{const r=await request('/login');if(r.status===200){ready=true;break;}}catch{}await pause(100);}assert(ready,'Built server did not start');
 // /proc may expose host PIDs while ChildProcess.pid is namespaced. Resolve only
 // our own direct child instead of accidentally sampling an unrelated host PID.
 try{const own=await readFile('/proc/self/status','utf8'),hostPid=own.match(/^Pid:\s+(\d+)/m)?.[1],children=(await readFile(`/proc/${hostPid}/task/${hostPid}/children`,'utf8')).trim().split(/\s+/);for(const pid of children){const status=await readFile(`/proc/${pid}/status`,'utf8');if(Number(status.match(/^NSpid:\s+(.+)$/m)?.[1].trim().split(/\s+/).at(-1))===child.pid)processStatus=`/proc/${pid}/status`;}}catch{}
 memoryTimer=setInterval(()=>{if(processStatus)readFile(processStatus,'utf8').then(text=>{peakRssKiB=Math.max(peakRssKiB,Number(text.match(/^VmRSS:\s+(\d+)/m)?.[1]||0));}).catch(()=>{});},1000);
 for(const rep of reps){const result=accepted(await request('/api/mobile-route',{member:rep,method:'POST',body:{action:'begin',createKey:randomUUID(),deviceId:rep.deviceId,continuous:true}}));assert.equal(result.memberId,rep.id);rep.dayId=result.day.id;}
 // A deliberately forged cross-member write must fail without changing the victim.
 const forbidden=await request('/api/mobile-route',{member:reps[0],method:'POST',body:{action:'samples',dayId:reps[1].dayId,deviceId:reps[1].deviceId,points:[{id:randomUUID(),capturedAt:new Date().toISOString(),latitude:21.5,longitude:39.2,accuracy:10,stopId:null}]}});assert.equal(forbidden.status,404);denialChecks++;
 const start=performance.now();startedAt=new RealDate().toISOString();await Promise.all(reps.map(rep=>worker(rep,start+seconds*1000)));finishedAt=new RealDate().toISOString();const elapsed=(performance.now()-start)/1000;
 // Final reads check own persisted rows are accessible and every response stays scoped.
 for(const rep of reps)checkCrm(accepted(await request('/api/crm',{member:rep})),rep);
 const storedPoints=(await db.prepare('SELECT p.*,d.member_id FROM crm_mobile_route_points p JOIN crm_mobile_route_days d ON d.id=p.day_id').all()).results;
 assert.equal(storedPoints.length,expectedPoints.size,'Missing or extra GPS rows, including forbidden writes');
 for(const row of storedPoints){const expected=expectedPoints.get(row.point_id);assert(expected?.acknowledged,'GPS write was stored without a verified acknowledgement');assert.equal(row.member_id,expected.memberId);assert.equal(row.day_id,expected.dayId);assert.equal(row.captured_at,expected.point.capturedAt);assert.equal(row.latitude,expected.point.latitude);assert.equal(row.longitude,expected.point.longitude);}
 const storedVisits=(await db.prepare("SELECT id,parent_id,data FROM crm_records WHERE id NOT LIKE 'load-%'").all()).results;
 assert.equal(storedVisits.length,expectedVisits.size,'Missing or duplicate visits');
 for(const row of storedVisits){const expected=expectedVisits.get(row.id),data=JSON.parse(row.data);assert(expected,'Unexpected visit');assert.equal(row.parent_id,expected.customerId);assert.equal(data.performedBy,expected.memberId);assert.equal(data.summary,expected.summary);assert.equal((await db.prepare('SELECT COUNT(*) n FROM crm_visit_numbers WHERE record_id=?').bind(row.id).first()).n,1);assert.equal((await db.prepare("SELECT COUNT(*) n FROM crm_audit WHERE record_id=? AND action='visit-receipt'").bind(row.id).first()).n,1);}
 assert.equal((await db.prepare('PRAGMA integrity_check').first()).integrity_check,'ok');assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 assert.equal((await db.prepare("SELECT COUNT(*) n FROM crm_records WHERE id LIKE 'load-history-%'").first()).n,history,'Historical records changed');
 assert(reps.every(rep=>rep.cycles>0),'Each configured representative must complete a cycle');
 const count=[...metrics.values()].reduce((n,item)=>n+item.latencies.length,0);
 report={ok:errors.length===0,startedAt,finishedAt,elapsedSeconds:Math.round(elapsed*100)/100,fixture:{representatives:users,territories:2,factories:users*factoriesPerRep,historicalVisits:history},workload:{durationSeconds:seconds,perRepCycleMinimumMs:interval,gpsSamplesPerCycle:1,crmReadEveryCycles:3,visitEveryCycles:5,gpsReplayEveryCycles:10,visitReplayed:true,cycles:reps.reduce((n,r)=>n+r.cycles,0),minCyclesPerRep:Math.min(...reps.map(r=>r.cycles)),maxCyclesPerRep:Math.max(...reps.map(r=>r.cycles)),requests:count,requestsPerSecond:Math.round(count/elapsed*100)/100},metrics:summaries(),integrity:{gpsRows:storedPoints.length,visitRows:storedVisits.length,gpsReplays:pointReplays,visitReplays,crmIsolationChecks,gpsIsolationChecks,crossMemberWriteDenials:denialChecks,noLostOrDuplicateAcknowledgedWrites:true,sqliteIntegrity:'ok',foreignKeyViolations:0,historicalRowsUnchanged:true},errors,environment:{node:process.version,platform:process.platform,architecture:process.arch,osRelease:os.release(),cpus:os.cpus().length,cpuModel:os.cpus()[0]?.model,availableParallelism:os.availableParallelism(),memoryTotalBytes:os.totalmem(),cgroupCpuMax:cgroupCpu,cgroupMemoryMaxBytes:cgroupMemory,peakServerRssMiB:peakRssKiB?Math.round(peakRssKiB/1024*100)/100:null,transport:'loopback TCP',storage:'private local SQLite WAL, synchronous FULL',productionBuild:true,captureClock:'test-only offset to 12:00 Asia/Riyadh; real elapsed time measured',builtServerSha256,serverEntrySha256:createHash('sha256').update(await readFile(path.join(release,'server.js'))).digest('hex')},limits:['Synthetic local loopback workload; not a Namecheap hosting capacity certification.','Sessions were pre-issued only in this temporary database; OTP throughput is not measured.','Real phones, GPS sensors, battery behavior, mobile networks, reverse proxy, disk quota and hosting contention were not tested.','Paced closed-loop users wait for each operation; slower runs produce fewer requests. p99 measures observed completed requests, not an open-loop arrival queue.','The operating system memory figure may exceed the container quota; sampled server RSS excludes the load-generator process.']};
}catch(error){report={ok:false,startedAt,finishedAt:new RealDate().toISOString(),error:error.message,errors,metrics:summaries(),serverDiagnostics:log.replace(/[a-f0-9]{64}/gi,'[redacted]')};process.exitCode=1;}
finally{clearInterval(memoryTimer);agent.destroy();if(child&&child.exitCode===null){child.kill();await once(child,'exit');}db?.close();await rm(work,{recursive:true,force:true});}
report.fixture??={representatives:users,territories:2,factories:users*factoriesPerRep,historicalVisits:history};
report.requestedWorkload={durationSeconds:seconds,perRepCycleMinimumMs:interval};
report.environment??={node:process.version,platform:process.platform,architecture:process.arch,osRelease:os.release(),cpus:os.cpus().length,cpuModel:os.cpus()[0]?.model,availableParallelism:os.availableParallelism(),cgroupCpuMax:cgroupCpu,cgroupMemoryMaxBytes:cgroupMemory,transport:'loopback TCP',productionBuild:true,captureClock:'test-only offset to 12:00 Asia/Riyadh; real elapsed time measured',builtServerSha256};
if(!report.ok)process.exitCode=1;
if(output)await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
