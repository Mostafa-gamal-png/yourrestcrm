// «خريطة المصانع»: the yellow pins, the representatives' work areas and the streets with no customer (the owner, 2026-11-19: the port of
// GSCO 2.13.81 and 2.13.82; lib/work-area-geometry.ts, lib/work-area-streets.ts, lib/work-areas.ts, lib/work-areas-server.ts, migrations
// 0023 and 0024), without a build: the geometry (the drawn polygon's checks, the 500 m default around the representative's pins and its
// groups, the 50 m rule, the cut into pieces), the 0.01° cells and their keys, Overpass's answer checked and cached, the pause of a service
// that answers 429, 502, 503 or 504 or does not answer, several services in turn, the local data first, the permission cell «رسم مناطق عمل
// المناديب» and its ceiling, the seven fields of a yellow pin; then the routes GET/POST /api/work-areas and GET /api/work-area-streets on an
// isolated in-memory SQLite (the route modules compiled as the build does, the session faked, Overpass a stand-in that never leaves the
// process): who reads which representative (role, team and region), who draws for whom, a stale version (409), a retry that writes nothing
// twice, a switched-off cell, a hidden map, the audit kept out of GET /api/crm's recent changes. Synthetic people and factories only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'work-areas-')),seen=new Set();
process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};

// A clock the test holds: every `new Date()` and Date.now() of the modules reads it.
const RealDate=Date;let held=RealDate.parse('2026-11-19T09:00:00Z');
class HeldDate extends RealDate{constructor(...args){if(args.length)super(...args);else super(held);}static now(){return held;}}
globalThis.Date=HeldDate;

function compile(relative){if(seen.has(relative))return;seen.add(relative);const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';compile(source);return 'from '+JSON.stringify(path.join(out,source.replace(/\.tsx?$/,'.mjs')));});fs.writeFileSync(dest,code);}
// The modules read env when they load: one object, filled once the database exists.
globalThis.testEnv={};
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const u=globalThis.testUser;if(!u)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version FROM crm_members WHERE user_id=?').bind(u.userId).first();return {...u,provider:'email-otp',memberId:m?.id||'missing',memberVersion:m?.auth_version};}`);
for(const name of ['work-areas','work-area-streets','crm'])compile('app/api/'+name+'/route.ts');
for(const name of ['lib/work-area-geometry.ts','lib/work-area-streets.ts','lib/work-areas.ts','lib/work-areas-server.ts','lib/permissions.ts','lib/kpis.ts'])compile(name);
const load=name=>import(pathToFileURL(path.join(out,name)));
const G=await load('lib/work-area-geometry.mjs'),St=await load('lib/work-area-streets.mjs'),W=await load('lib/work-areas.mjs'),S=await load('lib/work-areas-server.mjs'),P=await load('lib/permissions.mjs'),K=await load('lib/kpis.mjs');

// ---- 1. The drawn area's checks (the page and the server share them).
const square=(lat,lng,half)=>({type:'Polygon',coordinates:[[[lng-half,lat-half],[lng+half,lat-half],[lng+half,lat+half],[lng-half,lat+half],[lng-half,lat-half]]]});
const good=G.checkWorkAreaPolygon(square(26.43,50.1,0.01));
eq([good.ok,good.ring.length,Math.round(good.areaM2/1e5)],[true,4,44],'a square of 0.02°: four corners, about 4.4 km²');
const km2=polygon=>Math.round(G.checkWorkAreaPolygon(polygon).areaM2/1e4)/100;
eq(G.checkWorkAreaPolygon({type:'Polygon',coordinates:[[[50.1,26.43],[50.11,26.43],[50.1,26.43]]]}).error,'ارسم منطقة العمل بثلاث نقاط على الأقل.','two corners are refused');
eq(G.checkWorkAreaPolygon(square(40,50,0.01)).error,'منطقة العمل خارج حدود المملكة العربية السعودية.','outside the Kingdom');
eq(G.checkWorkAreaPolygon(square(26.43,50.1,0.1)).error,'يتجاوز طول منطقة العمل أو عرضها 15 كم.','wider than 15 km');
eq(G.checkWorkAreaPolygon(square(26.43,50.1,0.0002)).error,'منطقة العمل صغيرة جدًا.','smaller than 2,500 m²');
eq(G.checkWorkAreaPolygon({type:'Polygon',coordinates:[[[50.1,26.43],[50.12,26.45],[50.12,26.43],[50.1,26.45]]]}).error,'أضلاع منطقة العمل متقاطعة. حرّك النقاط حتى لا تتقاطع الحدود.','a bow tie crosses itself');
eq(G.checkWorkAreaPolygon({type:'Polygon',coordinates:[Array.from({length:202},(_,i)=>[50.1+0.01*Math.cos(i/202*2*Math.PI),26.43+0.01*Math.sin(i/202*2*Math.PI)])]}).error,'منطقة العمل تتجاوز 200 نقطة.','more than 200 corners');
for(const bad of [null,'x',{type:'Point',coordinates:[50,26]},{type:'Polygon',coordinates:[[[50,'26'],[50.1,26],[50.1,26.1]]]},{type:'Polygon',coordinates:[[[50,26],[50.1,26],[50.1,26.1]],[[50,26],[50.1,26],[50.1,26.1]]]}])eq(G.checkWorkAreaPolygon(bad).error,'شكل منطقة العمل غير صحيح.','a shape that is not one polygon of numbers: '+JSON.stringify(bad));
eq(G.ringToGeoJson(good.ring).coordinates[0].length,5,'stored closed, [longitude, latitude]');

// ---- 2. The 500 m default and its groups; the 50 m rule.
const A=[26.43,50.1],B=[26.432,50.103],C=[26.5,50.2];
eq(G.FALLBACK_BUFFER_METRES,500,'500 m around each pin');
eq(G.NEAR_PROJECT_METRES,50,'a customer within 50 m makes a street piece «not empty»');
const disks=G.pinDisks([A,B,C,A]);
eq(disks.rings.length,3,'one disk per place, a repeated pin counts once');
ok(G.pointInArea([26.4256,50.1],disks)&&!G.pointInArea([26.4244,50.1],disks),'a point 489 m south of a pin is in the area, one 622 m south is not');
eq(G.pinClusters([A,B,C]).map(g=>g.length),[2,1],'disks that overlap form one group (A and B 360 m apart), the far one its own');
ok(Math.abs(G.metresBetween(A,[26.43+0.00045,50.1])-50)<1,'0.00045° of latitude is about 50 m');
const street=[[26.42973,50.096],[26.42973,50.104]],far=[[26.4335,50.0985],[26.4335,50.1015]];
const ways=[{name:'شارع قريب',name_en:'Near street',points:street},{name:null,name_en:'Far street',points:far}];
const empty=St.emptyStreetSegments(G.pinDisks([A]),ways,[A]);
ok(empty.segments.some(s=>s.name_en==='Far street'),'the street 390 m from the pin is empty');
const nearOnly=St.emptyStreetSegments(G.pinDisks([A]),[ways[0]],[A]),nearAlone=St.emptyStreetSegments(G.pinDisks([A]),[ways[0]],[]);
ok(nearOnly.pieces===nearAlone.pieces&&nearOnly.empty<nearAlone.empty&&nearAlone.empty===nearAlone.pieces,'the pieces of the street beside the pin are not empty; its ends 300 m away are');
ok(empty.segments.every(s=>G.pointPolylineMetres(A,s.points)>50),'every empty piece is more than 50 m from the pin');
ok(St.emptyStreetSegments(G.pinDisks([A]),ways,[]).segments.some(s=>s.name==='شارع قريب'),'without the pin the near street is empty too');
ok(empty.segments.every(s=>G.polylineMetres(s.points)<=150.5),'pieces of at most 150 m');
eq(St.emptyStreetSegments(G.pinDisks([A]),ways,[A],{limit:1}).segments.length,1,'at most the limit, the rest counted');
eq(St.emptyStreetSegments({rings:[]},ways,[A]).segments,[],'no area, no piece');

// ---- 3. The 0.01° cells: a box is whole cells, named as the importer names a cell.
const box=St.streetBox(G.pinDisks([A]));
eq(box.key,'26.42,50.09,26.44,50.11','the box of a 500 m disk widened to the 0.01° grid');
eq(St.boxCells(box.box),{south:2642,north:2643,west:5009,east:5010,count:4},'four cells');
eq(St.cellKey(2642,5009),'26.42,50.09,26.43,50.10','a cell is named "south,west,north,east" with two decimals');
for(let i=0;i<400;i++){const lat=16+((i*7919)%1630)/100+0.0037,lng=34.5+((i*104729)%2110)/100+0.0041,b=St.streetBox({rings:[[[lat,lng],[lat+0.001,lng],[lat,lng+0.001]]]}),c=St.boxCells(b.box);if(c.count!==1||St.cellKey(c.south,c.west)!==b.key)throw Error('cell '+i+' '+b.key);}
checks++;
const enc=St.encodeStreets(ways);
eq(St.decodeStreets(enc),ways,'the compact form reads back');
eq([St.decodeStreets('{"v":2,"ways":[]}'),St.decodeStreets('nope'),St.decodeStreets('{"v":1,"ways":[["a",null,1,2,3]]}')],[null,null,null],'a damaged copy is refused');
eq(St.parseOverpassStreets({elements:[{type:'way',tags:{highway:'residential','name:ar':'شارع','name:en':'St'},geometry:[{lat:26.4,lon:50.1},null,{lat:26.41,lon:50.11},{lat:26.42,lon:50.12}]},{type:'way',tags:{highway:'motorway'},geometry:[{lat:1,lon:1},{lat:2,lon:2}]},{type:'node'}]}),{ok:true,ways:[{name:'شارع',name_en:'St',points:[[26.41,50.11],[26.42,50.12]]}]},'only the kinds asked for; a missing point splits the line');
eq(St.parseOverpassStreets({elements:[],remark:'runtime error: Query timed out'}).ok,false,'a cut answer is never cached');

// ---- 4. The permission cell and the seven fields.
const ceiling=role=>P.cellCeiling(role,'map','edit');
eq(['admin','manager','supervisor','rep','marketing','customer_service','customer_service_manager'].map(ceiling),[true,true,false,false,false,false,false],'«رسم مناطق عمل المناديب»: the administrator and the sales manager');
const access=off=>({version:1,off,hidden:[],viewAll:false});
eq([P.can({role:'manager'},'map','edit'),P.can({role:'manager',access:access(['map:edit'])},'map','edit'),P.can({role:'admin',access:access([])},'map','edit')],[true,false,true],'on by default, the administrator may switch it off for a sales manager');
eq(P.normalizePermissions('manager',null).cells['map:edit'],true,'a sales manager never saved: on');
eq(P.normalizePermissions('supervisor',{cells:{'map:edit':true}}).cells['map:edit'],undefined,'a supervisor cannot be given it (restrict-only)');
eq([W.mayDrawWorkAreas({role:'manager'}),W.mayDrawWorkAreas({role:'supervisor'}),W.mayDrawWorkAreas({role:'rep'}),W.mayDrawWorkAreas({role:'marketing'}),W.mayDrawWorkAreas({role:'customer_service_manager'}),W.mayDrawWorkAreas({role:'admin',access:access(['map:edit'])})],[true,false,false,false,false,false],'who draws');
eq(P.cellRefusalText('map','edit'),'غير مسموح لك بالتعديل في خريطة المصانع. راجع مدير النظام.','the refusal names the screen');
const full={name:'مصنع',region:'الشرقية',city:'الدمام',phone:'0500000000',contact:'أحمد',customerKind:'مصنع',location:'26.43, 50.1'};
eq([W.customerMissing(full),W.customerMissing({...full,phone:'  ',contact:''}),W.customerMissing({name:'مصنع',latitude:26.4,longitude:50.1})],[[],['phone','contact'],['region','city','phone','contact','customerKind']],'the evaluation\'s seven fields; blanks count as missing; a point is the place');
eq([K.customerFilledFields(full),K.customerFilledFields({...full,phone:''}),K.customerFilledFields(null)],[7,6,0],'the score counts the same fields');
eq([W.missingText(['phone','contact'],'ar'),W.missingText(['phone','contact'],'en')],['الهاتف، اسم المسؤول','Phone, Contact name'],'the card names them');

// ---- 5. What the page says, and the switch kept on the device.
const area={source:'fallback',rings:[],centers:[A],radius:500,clusters:1,area_km2:null,version:null,updated_at:null,updated_by_name:null,pins:1};
const streetsOf=(status,emptyCount)=>({rep_id:'r',area,status,fetched_at:null,segments:[],counts:{pieces:3,empty:emptyCount,returned:0},clusters:{total:1,shown:1,pending:0},truncated:false});
const state=(patch)=>({active:true,area,streets:null,areaError:'',streetsFailed:false,loading:false,...patch});
eq(W.workAreaLines(state({loading:true}),true,false,'ar'),['منطقة تقديرية: 500 م حول عملاء المندوب (1)','جارٍ تحميل الشوارع…'],'the fallback and the wait');
eq(W.workAreaLines(state({streets:streetsOf('ready',2)}),true,false,'en'),['Estimated area: 500 m around the representative\'s customers (1)','2 street pieces with no customer'],'English');
eq(W.workAreaLines(state({streets:streetsOf('ready',0)}),true,false,'ar').at(-1),'كل شوارع منطقة العمل فيها عملاء مسجلون.','no empty street');
eq(W.workAreaLines(state({streets:streetsOf('partial',2)}),true,true,'ar').slice(1),['حُمّل جزء من الشوارع فقط؛ افتح الخريطة بعد قليل لإكمالها.'],'partial; hidden marks are not counted');
eq(W.workAreaLines(state({streetsFailed:true}),false,false,'ar'),['الشوارع غير متاحة دون اتصال.'],'offline');
const store=new Map(),storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)};
W.writeHideStreets(true,storage);eq([W.readHideStreets(storage),W.readHideStreets({getItem:()=>{throw Error('blocked');}})],[true,false],'«إخفاء علامات الشوارع» is remembered; blocked storage forgets');
ok(W.validWorkAreaStreets(streetsOf('stale',1))&&!W.validWorkAreaStreets({...streetsOf('ready',0),status:'odd'}),'the answer is checked on the page');
eq(W.workAreaOutline({...area,source:'drawn',rings:[good.ring]})[0].length,5,'a drawn area is outlined closed');

// ---- 6. Overpass: one service at a time, the pause, several services, the cache.
const answer={version:0.6,elements:[{type:'way',id:1,tags:{highway:'residential',name:'شارع قريب','name:en':'Near street'},geometry:street.map(([lat,lon])=>({lat,lon}))},{type:'way',id:2,tags:{highway:'tertiary','name:en':'Far street'},geometry:far.map(([lat,lon])=>({lat,lon}))}]};
let asked=[];const reply=(status,body=answer)=>async url=>{asked.push(url);return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});};
const one='https://overpass.one.test/api/interpreter',two='https://overpass.two.test/api/interpreter';
S.configureOverpass({url:one+','+two+',http://evil.test/x,'+one,fetcher:reply(200),timeoutMs:200});
eq(S.overpassState().urls,[one,two],'the services named, in order, each once, plain http refused');
eq([S.overpassUrls(''),S.overpassUrls('ftp://x')].map(list=>list[0]),[S.OVERPASS_DEFAULT_URLS[0],S.OVERPASS_DEFAULT_URLS[0]],'none or none valid: the public ones');
ok(S.validOverpassUrl('http://127.0.0.1:9999/api')&&!S.validOverpassUrl('https://user:pw@x.test/')&&!S.validOverpassUrl('http://x.test/'),'HTTPS, or plain HTTP to this machine only (the tests), no credentials');
const queryBox={south:26.42,west:50.09,north:26.44,east:50.11},deadline=()=>Date.now()+60_000;
for(const status of [429,502,503,504]){
 S.resetOverpassState();asked=[];S.configureOverpass({fetcher:reply(status)});
 eq((await S.fetchStreets('k'+status,queryBox,deadline())).reason,'busy_'+status,status+' is «busy»');
 eq([asked,S.overpassState().paused],[[one,two],[one,two]],status+': each service asked once and paused');
 eq((await S.fetchStreets('again',queryBox,deadline())).reason,'cooling','paused: nothing is asked');eq(asked.length,2,'no third request');
 held+=S.OVERPASS_PAUSE_MS+1;eq(S.overpassState().paused,[],'two minutes later the services may be asked again');
}
S.resetOverpassState();asked=[];S.configureOverpass({fetcher:async url=>{asked.push(url);throw new TypeError('fetch failed');}});
eq([(await S.fetchStreets('net',queryBox,deadline())).reason,S.overpassState().paused.length],['network',2],'no answer at all (a network failure) pauses too');
S.resetOverpassState();asked=[];S.configureOverpass({fetcher:(url,init)=>{asked.push(url);return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))));}});
eq([(await S.fetchStreets('silent',queryBox,deadline())).reason,S.overpassState().paused.length],['network',2],'silence until the time limit pauses the service');
S.resetOverpassState();asked=[];S.configureOverpass({fetcher:reply(500)});
eq([(await S.fetchStreets('err',queryBox,deadline())).reason,S.overpassState().paused],['http_500',[]],'another error is not a pause');
S.resetOverpassState();asked=[];S.configureOverpass({fetcher:async url=>url===one?(asked.push(url),new Response('busy',{status:502})):reply(200)(url)});
const second=await S.fetchStreets('turn',queryBox,deadline());
eq([second.ok,second.ways.length,asked,S.overpassState().paused],[true,2,[one,two],[one]],'the first busy, the second answers');
S.resetOverpassState();asked=[];S.configureOverpass({fetcher:async url=>{asked.push(url);await new Promise(r=>setTimeout(r,20));return new Response(JSON.stringify(answer),{status:200});}});
const [same1,same2]=await Promise.all([S.fetchStreets('same',queryBox,deadline()),S.fetchStreets('same',queryBox,deadline())]);
eq([same1===same2||JSON.stringify(same1)===JSON.stringify(same2),asked.length],[true,1],'the same box asked twice at once shares one request');
const queue=await Promise.all([1,2,3,4,5].map(n=>S.fetchStreets('q'+n,queryBox,deadline())));
eq(queue.map(r=>r.ok?'ok':r.reason),['ok','ok','ok','queue','queue'],'a short queue: one at a time, three waiting at most');
S.resetOverpassState();

// ---- 7. The routes on an isolated database.
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
const migrations=fs.readdirSync(path.join(root,'drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).sort();
eq(migrations.slice(-2),['0023_work_areas.sql','0024_local_streets.sql'],'the two newest migrations');
for(const name of migrations)sql.exec(fs.readFileSync(path.join(root,'drizzle',name),'utf8'));
class Statement{constructor(q,a=[]){this.q=q;this.a=a;}bind(...a){return new Statement(this.q,a);}async run(){const r=sql.prepare(this.q).run(...this.a);return{meta:{changes:Number(r.changes)}};}async all(){return{results:sql.prepare(this.q).all(...this.a)};}async first(){return sql.prepare(this.q).get(...this.a)||null;}}
const DB={prepare:q=>new Statement(q),batch:async statements=>{sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(/^\s*(SELECT|WITH)/i.test(s.q)?{...await s.all(),meta:{changes:0}}:await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
Object.assign(globalThis.testEnv,{DB,YR_APP_ORIGIN:'https://test.invalid',YR_OVERPASS_URL:one});
const created=new RealDate(held).toISOString();
const member=(id,role,supervisor=null,region='eastern',active=1)=>sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,?,0,?)').run(id,'u-'+id,id+'@yourrest.org','اسم '+id,role,'الرئيسي',supervisor,region,active,created);
member('owner','admin',null,'all');member('mgr','manager',null,'all');member('mgrE','manager',null,'eastern');member('mgrW','manager',null,'western');
member('sup','supervisor','mgr');member('sup2','supervisor','mgr');
member('rep1','rep','sup','eastern,central');member('mk1','marketing','sup');member('rep2','rep','sup2');member('repW','rep','mgr','western');member('gone','rep','sup','eastern',0);
member('csm','customer_service_manager','mgr');member('cs','customer_service','csm');
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-owner')").run();
const record=(id,assigned,data)=>sql.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').run(id,'customer',null,assigned,'الرئيسي',JSON.stringify(data),created,created);
// rep1's customers: two near each other (one group), one far, one «خامل», one with no point, one in the central region, one outside the Kingdom.
record('cA','rep1',{...full,name:'مصنع أ',latitude:A[0],longitude:A[1],customerStatus:'نشط'});
record('cB','rep1',{name:'مصنع ب',region:'الشرقية',location:'https://maps.google.com/?q=26.432,50.103',customerStatus:'نصف نشط'});
record('cC','rep1',{name:'مصنع ج',region:'الشرقية',location:'26.5, 50.2'});
record('cD','rep1',{name:'مصنع خامل',region:'الشرقية',location:'26.44, 50.11',customerStatus:'خامل'});
record('cE','rep1',{name:'مصنع بلا موقع',region:'الشرقية'});
record('cF','rep1',{name:'مصنع الوسطى',region:'الوسطى',location:'24.7, 46.7'});
record('cX','rep1',{name:'مصنع خارج',region:'الشرقية',location:'40.0, 50.0'});
// Another representative's customer right on the far street: it is no longer empty where it stands.
record('cG','rep2',{name:'مصنع آخر',region:'الشرقية',location:'26.4335, 50.1'});
record('cW','repW',{name:'مصنع الغرب',region:'الغربية',location:'21.5, 39.2'});
const user=id=>{globalThis.testUser=id?{userId:'u-'+id,email:id+'@yourrest.org',fullName:id}:null;};
const areas=await load('app/api/work-areas/route.mjs'),streetsRoute=await load('app/api/work-area-streets/route.mjs'),crm=await load('app/api/crm/route.mjs');
const call=async(handler,{as,body,url,origin='https://test.invalid'},status=200)=>{
 user(as);const request=body===undefined?new Request(url):new Request(url,{method:'POST',headers:{origin,'content-type':'application/json'},body:typeof body==='string'?body:JSON.stringify(body)});
 const response=await handler(request),data=await response.json();eq(response.status,status,(as||'anonymous')+' '+url+' '+JSON.stringify(body||'').slice(0,120)+' -> '+JSON.stringify(data).slice(0,240));return data;
};
const get=(as,query,status)=>call(areas.GET,{as,url:'https://test.invalid/api/work-areas?'+new URLSearchParams(query)},status);
const streets=(as,rep,status)=>call(streetsRoute.GET,{as,url:'https://test.invalid/api/work-area-streets?member='+encodeURIComponent(rep)},status);
const post=(as,body,status)=>call(areas.POST,{as,url:'https://test.invalid/api/work-areas',body:{request_id:crypto.randomUUID(),...body}},status);
const list=async as=>(await get(as,{list:'1'})).reps.map(r=>r.id);

// 7a. Nobody signed in, another origin, customer service, a hidden map.
await get(null,{list:'1'},401);await streets(null,'rep1',401);await post(null,{},401);
await call(areas.POST,{as:'mgr',url:'https://test.invalid/api/work-areas',body:{},origin:'https://evil.example'},403);
for(const id of ['cs','csm']){await get(id,{list:'1'},403);await get(id,{member:'rep1'},403);await streets(id,'rep1',403);await post(id,{action:'delete',rep_id:'rep1',version:1},403);}
sql.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_by,updated_at) VALUES('sup','{}','[\"map\"]',1,'owner',?)").run(created);
await get('sup',{list:'1'},404);await streets('sup','rep1',404);
sql.prepare("DELETE FROM crm_member_permissions WHERE member_id='sup'").run();

// 7b. Who reads which representative: role, team (salesScopeMemberIds) and region; active field members only.
eq(await list('owner'),['mk1','rep1','rep2','repW'],'the administrator: every active field member');
eq(await list('mgr'),['mk1','rep1','rep2','repW'],'a sales manager of every region: every field member');
eq(await list('mgrE'),['mk1','rep1','rep2'],'a sales manager of the eastern region: not the western representative');
eq(await list('mgrW'),['repW'],'and the western one only the western');
eq(await list('sup'),['mk1','rep1'],'a supervisor: his own representative and marketing officer');
eq(await list('rep1'),['rep1'],'a representative: himself');
eq(await list('mk1'),['mk1'],'a marketing officer: himself');
eq((await get('mgr',{list:'1'})).reps.find(r=>r.id==='rep1'),{id:'rep1',name:'اسم rep1',drawn:false},'name and whether an area is drawn; nothing else');
await get('rep1',{member:'rep2'},403);await streets('rep1','rep2',403);await get('sup',{member:'rep2'},403);await get('mgrE',{member:'repW'},403);await get('mgr',{member:'gone'},403);await get('mgr',{member:'cs'},403);await get('mgr',{member:'mgrE'},403);
await get('mgr',{member:''},400);
eq((await get('rep1',{})).rep_id,'rep1','a representative without ?member= reads his own');
sql.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_by,updated_at) VALUES('sup2','{\"viewAll\":true}','[]',1,'owner',?)").run(created);
eq(await list('sup2'),['mk1','rep1','rep2'],'«عرض بيانات الفريق بالكامل» widens what a supervisor reads (in his regions)');
sql.prepare("DELETE FROM crm_member_permissions WHERE member_id='sup2'").run();

// 7c. The default: 500 m around the representative's customers, «خامل», no point and outside the Kingdom left out, the reader's regions.
let view=await get('mgr',{member:'rep1'});
eq([view.area.source,view.area.radius,view.area.centers,view.area.clusters,view.can_edit],['fallback',500,[[26.43,50.1],[26.432,50.103],[26.5,50.2],[24.7,46.7]],3,true],'the sales manager of every region: four pins (the central one too) in three groups; he may draw');
eq((await get('mgrE',{member:'rep1'})).area.centers.length,3,'the eastern sales manager: the central customer is not his to see');
eq([(await get('rep1',{})).area.centers.length,(await get('rep1',{})).can_edit],[4,false],'the representative (eastern and central): his four; he never draws');
eq((await get('sup',{member:'rep1'})).area.centers.length,3,'the supervisor of the eastern region: three');
eq((await get('mgr',{member:'mk1'})).area,{source:'none',rings:[],centers:[],radius:500,clusters:0,area_km2:null,version:null,updated_at:null,updated_by_name:null,pins:0},'no customer and no drawing: no area');
eq((await streets('mgr','mk1')).status,'no_area','and no streets');

// 7d. The streets of the default area, through a stand-in for Overpass (nothing leaves this process).
asked=[];S.configureOverpass({fetcher:reply(200),timeoutMs:2000});
let found=await streets('rep1','rep1');
eq([found.status,found.clusters,asked.length],['ready',{total:3,shown:3,pending:0},3],'three groups, three boxes asked of Overpass');
ok(found.segments.length>0&&found.segments.every(s=>s.name_en==='Near street')&&found.counts.empty<found.counts.pieces,'another representative\'s customer stands on the far street, so none of it is empty; the ends of the near street are');
const pins=[A,B,[26.4335,50.1]];
ok(found.segments.every(s=>pins.every(p=>G.pointPolylineMetres(p,s.points)>50)),'no empty piece within 50 m of any customer, another representative\'s included');
eq(Object.keys(found.segments[0]).sort(),['name','name_en','points'],'a piece carries its line and its street\'s name only');
eq(sql.prepare('SELECT COUNT(*) n FROM crm_osm_street_cache').get().n,3,'each box kept 30 days');
asked=[];found=await streets('mgr','rep1');eq([found.status,asked.length],['ready',0],'the same boxes again: from the cache, nothing asked');
held+=31*24*3600_000;asked=[];S.resetOverpassState();S.configureOverpass({fetcher:reply(429)});
found=await streets('rep1','rep1');eq([found.status,found.segments.length>0,asked],['stale',true,[one]],'31 days later and Overpass busy: the last copy, marked stale (YR_OVERPASS_URL names one service, paused after the first box)');
asked=[];found=await streets('rep1','rep1');eq([found.status,asked.length],['stale',0],'while paused nothing is asked');
S.resetOverpassState();
// 7e. The local data first: a box whose every cell was imported never asks Overpass, and shows the import's date.
sql.exec('DELETE FROM crm_osm_street_cache');
const importedAt='2026-11-20T08:00:00.000Z';
for(let y=2640;y<2660;y++)for(let x=5005;x<5025;x++){const own=St.boxCells({south:26.42,west:50.09,north:26.44,east:50.11});const cellWays=y>=own.south&&y<=own.north&&x>=own.west&&x<=own.east?St.encodeStreets([{name:'شارع قريب',name_en:'Near street',points:street}]):St.encodeStreets([]);sql.prepare('INSERT INTO crm_osm_street_local VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(St.cellKey(y,x),y,x,y/100,x/100,(y+1)/100,(x+1)/100,cellWays,cellWays.length>20?1:0,'eastern-1','osm:test',importedAt);}
asked=[];S.configureOverpass({fetcher:reply(200)});
found=await streets('rep1','rep1');
eq([found.status,asked.length,found.fetched_at],['ready',1,importedAt],'the boxes near A and B come from the local data (the far group asks Overpass): ready, dated by the import');
ok(found.segments.length>0&&found.segments.every(s=>s.name_en==='Near street'),'and the local streets are cut the same way');
held-=31*24*3600_000;

// 7f. Drawing: who, for whom, versions, retries, the audit.
const polygon=square(26.43,50.1,0.01);
await post('sup',{action:'save',rep_id:'rep1',polygon,version:null},403);
await post('rep1',{action:'save',rep_id:'rep1',polygon,version:null},403);
await post('mk1',{action:'save',rep_id:'mk1',polygon,version:null},403);
await post('mgrE',{action:'save',rep_id:'repW',polygon,version:null},403);
await post('mgr',{action:'save',rep_id:'sup',polygon,version:null},403);
await post('mgr',{action:'save',rep_id:'rep1',polygon:square(26.43,50.1,0.1),version:null},400);
await post('mgr',{action:'save',rep_id:'rep1',polygon,version:null,extra:1},400);
await post('mgr',{action:'save',rep_id:'rep1',polygon,version:2},409);
sql.prepare("INSERT INTO crm_member_permissions(member_id,permissions,hidden,version,updated_by,updated_at) VALUES('mgr','{\"map:edit\":false}','[]',1,'owner',?)").run(created);
eq((await post('mgr',{action:'save',rep_id:'rep1',polygon,version:null},403)).error,'غير مسموح لك بالتعديل في خريطة المصانع. راجع مدير النظام.','the administrator switched the cell off: refused in its words');
eq((await get('mgr',{member:'rep1'})).can_edit,false,'and the page draws no tools');
sql.prepare("DELETE FROM crm_member_permissions WHERE member_id='mgr'").run();
const first=crypto.randomUUID();
let saved=await post('mgr',{action:'save',rep_id:'rep1',polygon,version:null,request_id:first});
eq([saved.ok,saved.version],[true,1],'the sales manager draws rep1\'s area');
eq(await post('mgr',{action:'save',rep_id:'rep1',polygon,version:null,request_id:first}),{ok:true,rep_id:'rep1',version:1,repeated:true},'the same request after a lost answer saves nothing twice');
view=await get('rep1',{});
eq([view.area.source,view.area.vertices,view.area.area_km2,view.area.version,view.area.updated_by_name,view.area.rings[0].length],['drawn',undefined,km2(polygon),1,'اسم mgr',4],'the representative reads the drawn area');
eq((await get('mgr',{list:'1'})).reps.find(r=>r.id==='rep1').drawn,true,'listed as drawn');
await post('owner',{action:'save',rep_id:'rep1',polygon:square(26.44,50.11,0.008),version:null},409);
saved=await post('owner',{action:'save',rep_id:'rep1',polygon:square(26.44,50.11,0.008),version:1});eq(saved.version,2,'the administrator edits it on version 1');
await post('mgr',{action:'delete',rep_id:'rep1',version:1},409);
const removal=crypto.randomUUID();
eq(await post('mgr',{action:'delete',rep_id:'rep1',version:2,request_id:removal}),{ok:true,rep_id:'rep1',version:null},'deleted');
eq(await post('mgr',{action:'delete',rep_id:'rep1',version:2,request_id:removal}),{ok:true,rep_id:'rep1',version:null,repeated:true},'a delete sent again after a lost answer is done, not an error');
await post('mgr',{action:'delete',rep_id:'rep1',version:2},404);
eq((await get('rep1',{})).area.source,'fallback','back to the default');
// A drawn area too large for its streets: none is stored over 40 km², but a stored one is shown and its streets are refused politely.
eq(sql.prepare("SELECT action,record_id,actor FROM crm_audit WHERE action LIKE 'work-area:%' ORDER BY created_at,rowid").all().map(r=>[r.action,r.record_id,r.actor]),[['work-area:save','work-area:rep1','اسم mgr'],['work-area:save','work-area:rep1','اسم owner'],['work-area:delete','work-area:rep1','اسم mgr']],'one audit row per save and delete, none for a retry');
const detail=JSON.parse(sql.prepare("SELECT detail FROM crm_audit WHERE action='work-area:save' ORDER BY rowid LIMIT 1 OFFSET 1").get().detail);
eq([detail.before,detail.after],[{vertices:4,area_km2:km2(polygon),version:1},{vertices:4,area_km2:km2(square(26.44,50.11,0.008)),version:2}],'before and after, the shape\'s size only');
// Review 2026-11-19: the versions began again at 1 after a delete, so a page still holding the deleted area's version saved over the area
// drawn since (no 409), and a save or a delete sent again after a lost answer met another area (a 500 from the audit's key). Now a new area
// continues after the last deleted version, and a request's audit row (its receipt) answers it as done whatever happened since.
{
 const areaRow=()=>sql.prepare("SELECT version,updated_by,polygon FROM crm_work_areas WHERE member_id='rep1'").get();
 const A1=square(26.43,50.1,0.009),B1=square(26.44,50.11,0.007),C1=square(26.45,50.12,0.006);
 eq((await post('mgr',{action:'save',rep_id:'rep1',polygon:A1,version:null})).version,3,'a new area after the deleted version 2 is version 3');
 const stalePage=(await get('mgr',{member:'rep1'})).area.version;
 await post('owner',{action:'delete',rep_id:'rep1',version:3});
 eq((await post('owner',{action:'save',rep_id:'rep1',polygon:B1,version:null})).version,4,'drawn again: version 4');
 const before=areaRow();
 await post('mgr',{action:'save',rep_id:'rep1',polygon:C1,version:stalePage},409);
 await post('mgr',{action:'delete',rep_id:'rep1',version:stalePage},409);
 eq(areaRow(),before,'a page still holding the deleted area\'s version neither saves over nor deletes the area drawn since');
 const lostDelete=crypto.randomUUID();
 eq((await post('owner',{action:'delete',rep_id:'rep1',version:4,request_id:lostDelete})).ok,true,'deleted (its answer lost)');
 eq((await post('mgr',{action:'save',rep_id:'rep1',polygon:A1,version:null})).version,5,'another area drawn meanwhile: version 5');
 const drawn=areaRow();
 eq(await post('owner',{action:'delete',rep_id:'rep1',version:4,request_id:lostDelete}),{ok:true,rep_id:'rep1',version:null,repeated:true},'the delete sent again is done, not a second delete');
 eq(areaRow(),drawn,'and the area drawn since is still there');
 const lostSave=crypto.randomUUID();
 eq((await post('mgr',{action:'save',rep_id:'rep1',polygon:B1,version:5,request_id:lostSave})).version,6,'saved (its answer lost)');
 await post('owner',{action:'delete',rep_id:'rep1',version:6});
 eq(await post('mgr',{action:'save',rep_id:'rep1',polygon:B1,version:5,request_id:lostSave}),{ok:true,rep_id:'rep1',version:6,repeated:true},'the save sent again after the area was deleted is done, not drawn again');
 eq(areaRow(),undefined,'nothing was drawn again');
 await post('mgr',{action:'delete',rep_id:'rep1',version:6,request_id:lostSave},409);
 const audits=()=>sql.prepare("SELECT COUNT(*) n FROM crm_audit WHERE action LIKE 'work-area:%'").get().n,count=audits();
 await post('mgr',{action:'save',rep_id:'rep1',polygon:A1,version:null,request_id:lostDelete},409);
 eq([audits(),areaRow()],[count,undefined],'a receipt of another request is a conflict, and writes nothing');
}
// The commit re-checks the representative: one moved to another region meanwhile is not drawn for.
sql.prepare("UPDATE crm_members SET region_scope='western' WHERE id='rep2'").run();
await post('mgrE',{action:'save',rep_id:'rep2',polygon,version:null},403);
sql.prepare("UPDATE crm_members SET region_scope='eastern' WHERE id='rep2'").run();
// Drawn streets: the polygon is one box; inside the local data.
await post('mgr',{action:'save',rep_id:'rep2',polygon,version:null});
asked=[];found=await streets('mgr','rep2');
eq([found.area.source,found.status,found.clusters,asked.length],['drawn','ready',{total:1,shown:1,pending:0},0],'a drawn area inside the imported cells: one box, nothing asked');
// GET /api/crm's recent changes never carry the work areas' rows.
// (A row naming a customer's id proves the query itself leaves them out, not only the filter by visible records.)
sql.prepare("INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES('wa-probe','cA','اسم mgr','work-area:save','{}',?)").run(created);
sql.prepare("INSERT INTO crm_audit(id,record_id,actor,action,detail,created_at) VALUES('kept-probe','cA','اسم mgr','تعديل','{}',?)").run(created);
const crmData=await call(crm.GET,{as:'owner',url:'https://test.invalid/api/crm'});
eq([crmData.audits.some(a=>a.id==='kept-probe'),crmData.audits.filter(a=>String(a.action).startsWith('work-area:')).length],[true,0],'kept out of GET /api/crm\'s recent changes');
eq(sql.prepare('PRAGMA foreign_key_check').all().length,0,'every key sound');

console.log(JSON.stringify({ok:true,checks}));
