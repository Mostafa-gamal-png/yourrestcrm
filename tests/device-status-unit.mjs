// The phone's status report (lib/device-status.ts) and what the server does with it (lib/device-status-server.ts), on the real modules
// transpiled as the build does and imported (tests/device-status.mjs runs the same rules in a vm, where their coverage is not counted), with
// the timers, the clock and fetch played by stand-ins and the server's table on SQLite with every migration. Made-up members, fixed clock.
// 1. The text a phone sends: one line, no link or secret, no bidirectional override or control character, at most its length.
// 2. The device class from the browser's words, and the report built from a gate decision (the native app is always Android; a version,
//    a time and an accuracy that are not valid are dropped; counts capped; enrolment needs the same owner).
// 3. The signature: what makes a report news, and what travels with the next one.
// 4. The reporter with its default timers: at once, one minute apart, a heartbeat every 15 minutes, the back-off capped, a send that throws,
//    a refusal not repeated, a throttle, dispose.
// 5. The browser transport: ok, throttled, rejected, failed, the 15 s abort.
// 6. The server: the text and the phone's clock never trusted (a fix more than five minutes ahead dropped), one row per member and platform
//    replaced at most every 30 s in one statement, unreadable rows skipped, and who appears on the board (role, active, team and region).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';

const NativeDate=Date;let clock=NativeDate.parse('2026-11-22T06:00:00.000Z');
globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
const root=process.cwd(),runtime=path.join(root,'.sites-runtime');fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'device-status-unit-')),seen=new Set();
process.on('exit',()=>{globalThis.Date=NativeDate;fs.rmSync(out,{recursive:true,force:true});});
function compile(relative){
 if(seen.has(relative))return;seen.add(relative);
 const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));
 fs.mkdirSync(path.dirname(dest),{recursive:true});
 let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
  if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
  let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
  if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';
  compile(source);return 'from '+JSON.stringify(path.join(out,source.replace(/\.tsx?$/,'.mjs')));
 });
 fs.writeFileSync(dest,code);
}
const load=async relative=>{compile(relative);return import(pathToFileURL(path.join(out,relative.replace(/\.tsx?$/,'.mjs'))));};
const D=await load('lib/device-status.ts'),V=await load('lib/device-status-server.ts');

// Timers that follow the fixed clock.
let timers=[],timerId=0;
globalThis.setTimeout=(callback,delay)=>{const timer={id:++timerId,at:clock+Math.max(0,Number(delay)||0),callback};timers.push(timer);return timer.id;};
globalThis.clearTimeout=id=>{timers=timers.filter(timer=>timer.id!==id);};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function advance(ms){const end=clock+ms;for(;;){timers.sort((a,b)=>a.at-b.at||a.id-b.id);const next=timers[0];if(!next||next.at>end)break;timers.shift();clock=Math.max(clock,next.at);next.callback();await settle();}clock=end;await settle();}

let checks=0;const counts={};
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;},ok=(value,message)=>{assert.ok(value,message);checks++;};
const counted=async(part,fn)=>{const before=checks;await fn();counts[part]=checks-before;};

const device=(patch={})=>({appVersion:'1.0.15',continuousSupported:true,scheduleSupported:true,gapCountKnown:true,consent:true,enrolled:true,ownerMatches:true,foreground:'granted',fineLocation:'granted',notifications:'granted',background:'granted',locationServices:true,tracking:true,windowActive:true,lastFixAt:'2026-11-22T08:59:00+03:00',accuracy:12,pendingCount:3,pendingGapCount:0,quarantinedCount:1,error:'',syncError:'',...patch});
const source=(patch={},native=true)=>({native,loading:false,failed:false,upgradeRequired:false,device:native?device(patch):null});
const allowed={status:'allowed'};
const report=(patch={},decision=allowed,native=true,deviceClass='desktop')=>D.buildDeviceReport(decision,source(patch,native),deviceClass);

await counted('text',async()=>{
 const clean=D.cleanStatusText;
 eq(clean('  لا يوجد اتصال بالخادم  '),'لا يوجد اتصال بالخادم','Arabic kept, trimmed');
 for(const mark of ['‎','‏','‪','‫','‬','‭','‮','⁦','⁧','⁨','⁩','\u0000','\u0007','\t','\u001f','\u007f','\u0085','\u009f'])
  eq(clean('الموقع'+mark+'متوقف'),'الموقعمتوقف','taken out: U+'+mark.codePointAt(0).toString(16).padStart(4,'0'));
 // Mended 2026-11-23 (found by the unit tests): the invisible marks a paste brings and the line and paragraph separators.
 for(const mark of ['\u061c','\u200b','\u200c','\u200d','\u2028','\u2029','\u2060','\ufeff'])
  eq(clean('الموقع'+mark+'متوقف'),'الموقعمتوقف','taken out: U+'+mark.codePointAt(0).toString(16).padStart(4,'0'));
 eq(clean('ok\u2028x'),'okx','a line separator does not split the line it is in');
 eq(clean('\u0627\u0644\u0645\u0648\u0642\u0639 ok'),'\u0627\u0644\u0645\u0648\u0642\u0639 ok','letters and spaces are kept');
 eq(clean('‮تم‬ الإرسال'),'تم الإرسال','an override that would reverse the line');
 eq(clean('الأول\r\nالثاني'),'الأول','only the first line');
 eq(clean('\nالثاني'),'','a first line that is empty is empty');
 eq(clean('‏‎⁧'),'','only marks: nothing');
 eq(clean('فشل https://evil.example/x?token=abc الآن'),'فشل [link] الآن','a link is not sent');
 eq(clean('فشل الإرسال token=abc123 password: "سر"'),'فشل الإرسال token=[redacted] password: [redacted]','secrets are not sent');
 const bearer=clean('Authorization: Bearer eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl');ok(bearer.startsWith('Authorization: [redacted]')&&!bearer.includes('eyJ'),'a bearer token');
 eq([clean('x'.repeat(500)).length,clean('ب'.repeat(500)).length,clean('x'.repeat(50),10).length],[240,240,10],'240 characters, or the length asked for');
 eq(clean('‏'.repeat(5)+'abcdef',8),'abc','the length counts before the marks are taken out (never longer)');
 eq([clean(undefined),clean(null),clean(42),clean({}),clean({message:'الرسالة'}),clean(new Error('خطأ الجسر\nstack')),clean(['x'])],['','','','','الرسالة','خطأ الجسر',''],'only a text or an error\'s message');
});

await counted('device class and report',async()=>{
 const detect=D.detectDeviceClass;
 eq([detect('Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit Chrome/131 Mobile'),detect('android webview'),detect('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X)'),detect('Mozilla/5.0 (iPod touch; CPU iPhone OS 12_5)'),detect('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')],['android','android','iphone','iphone','iphone'],'Android before Linux; iPhone, iPod and iPad');
 eq([detect('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)','MacIntel',2),detect('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)','MacIntel',1),detect('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)','MacIntel',0),detect('Mozilla/5.0','MacIntel',5)],['iphone','desktop','desktop','iphone'],'an iPad that says it is a Mac has more than one touch point');
 eq([detect('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'),detect('Mozilla/5.0 (X11; Linux x86_64)'),detect('Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)'),detect(''),detect('curl/8.5.0'),detect('Mozilla/5.0','Win32',0)],['desktop','desktop','desktop','other','other','other'],'computers, and everything else');
 eq(D.buildDeviceReport({status:'checking'},source(),'desktop'),null,'«checking» is never reported');
 const healthy=report();
 eq(healthy,{platform:'android-app',deviceClass:'android',gate:'ok',missing:[],appVersion:'1.0.15',tracking:true,windowActive:true,enrolled:true,consent:true,foreground:'granted',fineLocation:'granted',notifications:'granted',background:'granted',locationServices:true,lastFixAt:'2026-11-22T05:59:00.000Z',accuracy:12,pendingCount:3,pendingGapCount:0,quarantinedCount:1,error:'',syncError:''},'the native app: every fact, the fix time in UTC');
 ok(D.deviceReportSchema.safeParse(healthy).success,'a built report passes the server\'s schema');
 eq(report({},allowed,true,'iphone').deviceClass,'android','the native app is always Android, whatever the browser says');
 const blocked=report({background:'denied'},{status:'blocked',reason:'permission',missing:['background_location','notifications']});
 eq([blocked.gate,blocked.missing],['permission',['background_location','notifications']],'blocked: the reason and what is missing');
 const browser=D.buildDeviceReport({status:'blocked',reason:'browser',missing:[]},source({},false),'iphone');
 eq([browser.platform,browser.deviceClass,browser.gate,browser.appVersion,browser.tracking,browser.windowActive,browser.enrolled,browser.consent,browser.foreground,browser.locationServices,browser.lastFixAt,browser.accuracy,browser.pendingCount,browser.pendingGapCount,browser.quarantinedCount,browser.error],['browser','iphone','browser','',false,false,false,null,null,null,'',null,0,null,0,''],'a browser has no device facts');
 for(const version of ['1.0.15 <x>','١٫٠','1.0.15‏','v'.repeat(33),'a/b'])eq(report({appVersion:version}).appVersion,'','an app version that is not plain: '+JSON.stringify(version));
 eq([report({appVersion:'1.0.15-beta_2'}).appVersion,report({appVersion:''}).appVersion,report({appVersion:'v'.repeat(32)}).appVersion.length],['1.0.15-beta_2','',32],'a plain version is kept');
 eq([report({lastFixAt:'yesterday'}).lastFixAt,report({lastFixAt:''}).lastFixAt,report({lastFixAt:'2026-11-22T05:59:00Z'}).lastFixAt],['','','2026-11-22T05:59:00.000Z'],'a fix time that is not a time is empty');
 eq([NaN,Infinity,-1,100000.5,0,100000,null,undefined].map(accuracy=>report({accuracy}).accuracy),[null,null,null,null,0,100000,null,null],'an accuracy outside 0 to 100 km is unknown');
 eq([report({pendingCount:20_000_000}).pendingCount,report({pendingGapCount:20_000_000}).pendingGapCount,report({quarantinedCount:20_000_000}).quarantinedCount,report({pendingGapCount:null}).pendingGapCount],[10_000_000,10_000_000,10_000_000,null],'counts are capped; an unknown gap count stays unknown');
 eq([report({ownerMatches:false}).enrolled,report({enrolled:false}).enrolled],[false,false],'enrolled for another account is not enrolled');
 eq([report({consent:null}).consent,report({fineLocation:null}).fineLocation,report({locationServices:false}).locationServices],[null,null,false],'unknown stays unknown');
 const noisy=report({error:'تعذر الإرسال‮ https://x.example/?token=1\nstack',syncError:'s'.repeat(500)});
 eq([noisy.error,noisy.syncError.length],['تعذر الإرسال [link]',240],'the texts are cleaned and capped');
 ok(D.deviceReportSchema.safeParse(noisy).success,'and pass the schema');
 const parse=patch=>D.deviceReportSchema.safeParse({...healthy,...patch}).success;
 eq([parse({lastFixAt:'2026-11-22T08:59:00+03:00'}),parse({missing:Array(8).fill('consent')}),parse({missing:Array(9).fill('consent')}),parse({error:'ع'.repeat(400)}),parse({error:'ع'.repeat(401)}),parse({deviceClass:'tablet'}),parse({accuracy:NaN}),parse({pendingGapCount:null}),parse({consent:'yes'})],[true,true,false,true,false,false,false,true,false],'the schema: an offset is a time; 8 requirements at most; 400 characters; known classes; a number for accuracy');
});

await counted('signature',async()=>{
 const sig=D.reportSignature,base=report();
 for(const patch of [{lastFixAt:'2026-11-22T06:30:00Z'},{accuracy:900},{pendingCount:999},{pendingGapCount:0},{quarantinedCount:50}])eq(sig(report(patch)),sig(base),'travels with the next report: '+Object.keys(patch)[0]);
 for(const patch of [{pendingCount:0},{pendingGapCount:2},{pendingGapCount:null,gapCountKnown:false},{appVersion:'1.0.16'},{tracking:false},{windowActive:false},{enrolled:false},{consent:false},{foreground:'denied'},{fineLocation:'prompt'},{notifications:'denied'},{background:'prompt'},{locationServices:false},{error:'خطأ'},{syncError:'خطأ'}]){
  const changed=sig(report(patch))!==sig(base);
  eq(changed,!(patch.pendingGapCount===null),'news: '+JSON.stringify(patch));
 }
 eq(sig(report({},{status:'blocked',reason:'setup',missing:['consent']}))!==sig(base),true,'a new gate is news');
 eq(sig(report({},{status:'blocked',reason:'setup',missing:['consent']}))!==sig(report({},{status:'blocked',reason:'setup',missing:['enrollment']})),true,'and so is what is missing');
});

await counted('reporter',async()=>{
 const A=report(),B=report({background:'denied'},{status:'blocked',reason:'permission',missing:['background_location']}),C=report({locationServices:false},{status:'blocked',reason:'location_services',missing:['location_services']});
 let sends=[],plan=[];
 const send=async value=>{sends.push({at:clock,value});const next=plan.shift();if(next instanceof Error)throw next;return next||'ok';};
 const start=clock;timers=[];
 let reporter=D.createDeviceReporter({send});
 reporter.submit(A);await advance(0);
 eq(sends.map(item=>item.at-start),[0],'with the default timers: the first report at once');
 await advance(15*60_000-1);eq(sends.length,1,'an unchanged phone is quiet for 15 minutes');
 await advance(1);eq(sends.length,2,'then the heartbeat');
 reporter.submit(B);await advance(59_999);eq(sends.length,2,'a change within a minute of the last report waits');
 await advance(1);eq([sends.length,sends[2].value.gate],[3,'permission'],'one minute after it');
 reporter.dispose();await advance(3_600_000);eq(sends.length,3,'a disposed reporter sends nothing');
 reporter.submit(C);reporter.nudge(true);await advance(3_600_000);eq(sends.length,3,'nor after a submit or a nudge');

 sends=[];plan=[new Error('network'),'ok'];timers=[];
 reporter=D.createDeviceReporter({send});reporter.submit(A);await advance(0);
 eq(sends.length,1,'a send that throws');
 await advance(59_999);eq(sends.length,1,'counts as failed: retried after a minute');
 await advance(1);eq(sends.length,2,'retried');
 reporter.dispose();

 sends=[];plan=Array(14).fill('failed');timers=[];
 reporter=D.createDeviceReporter({send,retryMs:1000,maxRetryMs:1e12,heartbeatMs:1e12});reporter.submit(A);await advance(0);
 await advance(10_000_000);
 eq(sends.slice(1).map((item,index)=>item.at-sends[index].at),[1000,2000,4000,8000,16000,32000,64000,128000,256000,512000,1024000,1024000,1024000,1024000],'the back-off doubles up to 1024 times the retry, then stays');
 reporter.dispose();

 sends=[];plan=['rejected','ok'];timers=[];
 reporter=D.createDeviceReporter({send});reporter.submit(A);await advance(0);
 await advance(3_600_000);eq(sends.length,1,'a refused report is never repeated, not even as a heartbeat');
 reporter.submit({...A,accuracy:99});await advance(3_600_000);eq(sends.length,1,'nor with only its volatile facts changed');
 reporter.submit(B);await advance(0);eq(sends.length,2,'a changed report is sent');
 reporter.submit(A);await advance(60_000);eq([sends.length,sends[2].value.gate],[3,'ok'],'after a success the refused state may be sent again');
 reporter.dispose();

 sends=[];plan=['throttled'];timers=[];
 reporter=D.createDeviceReporter({send,retryMs:30_000});reporter.submit(A);await advance(0);
 reporter.submit(B);await advance(29_999);eq(sends.length,1,'throttled: nothing until the retry, even for a change');
 await advance(1);eq([sends.length,sends[1].value.gate],[2,'permission'],'then the newest');
 reporter.nudge();await advance(0);eq(sends.length,2,'a nudge with nothing due sends nothing');
 reporter.dispose();

 sends=[];timers=[];reporter=D.createDeviceReporter({send});reporter.nudge(true);await advance(3_600_000);
 eq(sends.length,0,'nothing submitted: nothing sent');
 reporter.dispose();
});

await counted('browser transport',async()=>{
 const healthy=report();let calls=[];
 const serve=answer=>{calls=[];globalThis.fetch=async(url,init)=>{calls.push({url,init});return answer(init);};};
 const outcomes=[];
 for(const status of [200,201,204,429,400,401,403,404,409,413,422,499,500,502,503,302]){serve(()=>new Response(null,{status}));timers=[];outcomes.push([status,await D.postDeviceStatus(healthy),timers.length]);}
 eq(outcomes,[[200,'ok',0],[201,'ok',0],[204,'ok',0],[429,'throttled',0],[400,'rejected',0],[401,'rejected',0],[403,'rejected',0],[404,'rejected',0],[409,'rejected',0],[413,'rejected',0],[422,'rejected',0],[499,'rejected',0],[500,'failed',0],[502,'failed',0],[503,'failed',0],[302,'failed',0]],'2xx ok, 429 throttled, any other 4xx rejected, anything else failed; the timer cleared each time');
 serve(()=>new Response(null,{status:200}));await D.postDeviceStatus(healthy);
 const init=calls[0].init;
 eq([calls[0].url,init.method,init.credentials,init.cache,init.headers['Content-Type'],JSON.parse(init.body),init.signal instanceof AbortSignal],['/api/device-status','POST','same-origin','no-store','application/json',healthy,true],'the request');
 serve(()=>{throw new TypeError('Failed to fetch');});eq(await D.postDeviceStatus(healthy),'failed','no connection: failed, silently');
 serve(init=>new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')))));timers=[];
 const pending=D.postDeviceStatus(healthy);await settle();
 eq(timers.map(timer=>timer.at-clock),[15000],'bounded by 15 seconds');
 await advance(15000);
 eq([await pending,calls[0].init.signal.aborted,timers.length],['failed',true,0],'then aborted, and failed');
});

// The server's table.
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const file of fs.readdirSync(path.join(root,'drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).sort())sql.exec(fs.readFileSync(path.join(root,'drizzle',file),'utf8'));
class Statement{
 constructor(query,args=[]){this.query=query;this.args=args;}
 bind(...args){return new Statement(this.query,args);}
 async run(){const result=sql.prepare(this.query).run(...this.args);return {success:true,meta:{changes:Number(result.changes)}};}
 async all(){return {success:true,results:sql.prepare(this.query).all(...this.args).map(row=>({...row}))};}
 async first(){const row=sql.prepare(this.query).get(...this.args);return row?{...row}:null;}
}
const db={prepare:query=>new Statement(query)};
const member=(id,role,patch={})=>({id,userId:'u-'+id,email:id+'@yourrest.org',name:patch.name||id,role,branch:'الرئيسي',supervisorId:patch.supervisorId,regionScope:patch.regionScope||'all',active:patch.active??1,target:0,authVersion:1});
const people=[member('admin','admin'),member('sup-1','supervisor',{regionScope:'central'}),member('sup-2','supervisor',{regionScope:'western'}),member('manager','manager',{regionScope:'central,eastern'}),
 member('rep-a','rep',{supervisorId:'sup-1',regionScope:'central',name:'أحمد'}),member('rep-b','rep',{supervisorId:'sup-1',regionScope:'western',name:'بدر'}),member('rep-c','rep',{supervisorId:'sup-1',regionScope:'central',active:0,name:'جمال'}),
 member('rep-d','rep',{supervisorId:'sup-2',regionScope:'western',name:'داود'}),member('mkt','marketing',{supervisorId:'sup-1',regionScope:'central',name:'تسويق'}),member('service','customer_service',{regionScope:'central'})];
for(const person of people)sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,active,target,created_at,region_scope) VALUES(?,?,?,?,?,?,?,?,0,?,?)').run(person.id,person.userId,person.email,person.name,person.role,person.branch,person.supervisorId||null,person.active,'2026-11-01T00:00:00.000Z',person.regionScope);

await counted('server',async()=>{
 const now=NativeDate.parse('2026-11-22T06:00:00.000Z'),healthy=report();
 const cleaned=V.normalizeDeviceReport({...healthy,error:'‮خطأ https://x.example/a',syncError:'token=abc\nsecond',lastFixAt:'2026-11-22T09:05:00+03:00'},now);
 eq([cleaned.error,cleaned.syncError,cleaned.lastFixAt],['خطأ [link]','token=[redacted]','2026-11-22T06:05:00.000Z'],'the server cleans the text again; a fix five minutes ahead is kept, in UTC');
 eq(V.normalizeDeviceReport({...healthy,lastFixAt:'2026-11-22T06:05:00.001Z'},now).lastFixAt,'','a fix further ahead than the phone\'s clock may drift is dropped');
 eq([V.normalizeDeviceReport({...healthy,lastFixAt:''},now).lastFixAt,V.normalizeDeviceReport({...healthy,lastFixAt:'garbage'},now).lastFixAt,V.normalizeDeviceReport({...healthy,lastFixAt:'2020-01-01T00:00:00Z'},now).lastFixAt],['','','2020-01-01T00:00:00.000Z'],'no time is empty; an old one is kept');
 const original={...healthy,error:'‏x'};V.normalizeDeviceReport(original,now);eq(original.error,'‏x','the report given is not changed');
 eq(Object.keys(V.normalizeDeviceReport(healthy,now)).sort(),Object.keys(healthy).sort(),'nothing added or removed');

 const at=ms=>new NativeDate(now+ms).toISOString(),row=platform=>sql.prepare('SELECT * FROM crm_member_devices WHERE member_id=? AND platform=?').get('rep-a',platform);
 eq(await V.saveDeviceReport(db,'rep-a',healthy,at(0)),'saved','the first report');
 eq([row('android-app').app_version,row('android-app').reported_at,JSON.parse(row('android-app').data),row('android-app').version],['1.0.15',at(0),healthy,1],'one row: the version, the moment, the report');
 eq(await V.saveDeviceReport(db,'rep-a',{...healthy,error:'تغيّر'},at(V.DEVICE_REPORT_MIN_GAP_MS-1)),'throttled','another within 30 s is refused');
 eq([row('android-app').version,JSON.parse(row('android-app').data).error,row('android-app').reported_at],[1,'',at(0)],'and changes nothing');
 eq(await V.saveDeviceReport(db,'rep-a',{...healthy,error:'تغيّر'},at(V.DEVICE_REPORT_MIN_GAP_MS)),'saved','30 s later it replaces the row');
 eq([row('android-app').version,JSON.parse(row('android-app').data).error,sql.prepare("SELECT COUNT(*) n FROM crm_member_devices WHERE member_id='rep-a'").get().n],[2,'تغيّر',1],'the same row, its version counted');
 const browser={...healthy,platform:'browser',deviceClass:'iphone',appVersion:''};
 eq(await V.saveDeviceReport(db,'rep-a',browser,at(V.DEVICE_REPORT_MIN_GAP_MS+1)),'saved','the browser of the same member is another row, not throttled by the app');
 eq(row('browser').app_version,null,'no version is stored as none');
 eq(await V.saveDeviceReport(db,'rep-b',healthy,at(1)),'saved','another member is not throttled by the first');
 eq(V.DEVICE_REPORT_MIN_GAP_MS,30_000,'30 s');

 sql.prepare('INSERT INTO crm_member_devices(member_id,platform,app_version,reported_at,data,version) VALUES(?,?,?,?,?,1)').run('rep-d','android-app','1.0.0',at(5),'{not json');
 sql.prepare('INSERT INTO crm_member_devices(member_id,platform,app_version,reported_at,data,version) VALUES(?,?,?,?,?,1)').run('rep-d','browser','',at(6),JSON.stringify({...browser,memberId:'rep-a'}));
 sql.prepare('INSERT INTO crm_member_devices(member_id,platform,app_version,reported_at,data,version) VALUES(?,?,?,?,?,1)').run('mkt','browser','',at(7),JSON.stringify(browser));
 const statuses=await V.readDeviceStatuses(db,['rep-a','rep-d','mkt','nobody']);
 eq([...statuses.keys()].sort(),['mkt','rep-a'],'a row that is not JSON or not a report is skipped');
 eq(statuses.get('rep-a').map(item=>[item.platform,item.reportedAt]),[['browser',at(V.DEVICE_REPORT_MIN_GAP_MS+1)],['android-app',at(V.DEVICE_REPORT_MIN_GAP_MS)]],'newest first, each with its moment');
 eq((await V.readDeviceStatuses(db,['rep-b'])).size,1,'only the members asked for');
 eq((await V.readDeviceStatuses(db,[])).size,0,'none asked: none');

 const names=me=>V.trackingMembers({me:people.find(person=>person.id===me),members:people}).map(person=>person.id).sort();
 eq(names('admin'),['mkt','rep-a','rep-b','rep-d'],'the administrator: every active field member');
 eq(names('sup-1'),['mkt','rep-a'],'a supervisor: their own team in their region (not inactive, not another region, not another team)');
 eq(names('sup-2'),['rep-d'],'the other supervisor');
 eq(names('manager'),['mkt','rep-a'],'the manager: the teams, within the manager\'s regions');
 eq([names('rep-a'),names('service')],[['rep-a'],[]],'a representative sees only themself; customer service nobody');
 sql.prepare('INSERT INTO crm_mobile_route_days(id,member_id,device_id,date,region_scope,started_at,ended_at,last_point_at,data,version) VALUES(?,?,?,?,?,?,?,?,?,1)').run('day-a','rep-a','phone-1','2026-11-22','central','2026-11-22T05:00:00.000Z',null,'2026-11-22T05:50:00.000Z','{}');
 for(let index=0;index<3;index++)sql.prepare('INSERT INTO crm_mobile_route_points(day_id,point_id,captured_at,received_at,latitude,longitude,accuracy) VALUES(?,?,?,?,?,?,?)').run('day-a','p'+index,at(-600000+index),at(0),24.7,46.6,10);
 sql.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,?,?,?,?,1,?)').run('c1','customer',null,'rep-a','الرئيسي',JSON.stringify({name:'مصنع'}),at(-86400000),at(-86400000),'fixture');
 sql.prepare("INSERT INTO crm_journey_stops(id,member_id,date,customer_id,region_scope,snapshot,selected_at,closed_at,state,data,version) VALUES(?,?,?,?,?,?,?,?,?,?,1)").run('stop-a','rep-a','2026-11-22','c1','central','{}',at(-3600000),null,'onsite',JSON.stringify({lastPoint:{capturedAt:'2026-11-22T05:55:00.000Z'}}));
 sql.prepare('INSERT INTO crm_journey_points(stop_id,point_id,captured_at,received_at,latitude,longitude,accuracy) VALUES(?,?,?,?,?,?,?)').run('stop-a','j1',at(-60000),at(0),24.7,46.6,8);
 const overview=await V.trackingOverview({me:people.find(person=>person.id==='sup-1'),members:people,db},'2026-11-22');
 eq(overview.map(item=>item.memberName),['أحمد','تسويق'],'the board in Arabic order of names');
 const first=overview[0];
 eq([first.memberId,first.lastPointAt,first.dayStartedAt,first.pointsOnDate,first.tripsOnDate,first.devices.length],['rep-a','2026-11-22T05:55:00.000Z',  '2026-11-22T05:00:00.000Z',4,1,2],'the newest point of either source, the day\'s start, its points and trips, and the phone\'s reports');
 eq([overview[1].lastPointAt,overview[1].pointsOnDate,overview[1].devices.length],[null,0,1],'a member with no point');
 eq(await V.trackingOverview({me:people.find(person=>person.id==='service'),members:people,db},'2026-11-22'),[],'nobody to show: nothing read');
});

console.log(JSON.stringify({ok:true,checks,counts,realBrowser:false,database:'SQLite in memory, every migration',clock:'fixed'}));
