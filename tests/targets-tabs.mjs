// «إخفاء تبويبات صفحة المستهدفات لكل حساب» (the owner, 2026-11-16, item 6 of the GSCO list; GSCO 2.13.58 performance.results,
// performance.collection, performance.quotations, performance.targets), without a build: the rules (lib/permissions.ts, lib/access.ts,
// lib/targets-hub.ts) and the routes on an isolated in-memory SQLite (the route modules compiled as the build does, the session faked).
// - The rules: which roles get a switch for which tab (the administrator never hidden; a representative's «أهدافي» has no tabs; customer
//   service has no targets screen), restrict-only (no stored value grants a tab, a forged access cannot reach the administrator), nothing
//   hidden by default, a row of the older shape read as before, the order kept, «انسخ الصلاحيات من» (copied, or skipped and named),
//   the tab to draw when the address or the browser names a hidden one, and the page left with no tab (hidden as a screen, unless «رفع
//   المبيعات» shows), and a request that serves only some tabs.
// - The routes: the administrator only saves (audited before and after), the member's next load carries the hidden tabs; each route that
//   serves one tab answers 404 «هذا الجزء غير متاح لحسابك. راجع مدير النظام.» once that tab is hidden and nothing else: POST /api/kpis
//   («نتائج الأداء»), GET/POST /api/kpi-evidence/import («التحصيل»), GET /api/erp-quotes («عروض الأسعار»), POST /api/targets and GET
//   /api/targets/history («المستهدفات والأوزان»); GET/POST /api/kpi-evidence (the three evaluation tabs) only when the three are hidden;
//   GET /api/sales (every tab and «المبيعات») keeps serving and leaves out the evaluation when its three tabs are hidden; another member of
//   the same role is untouched. Synthetic people only; no build, no network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'targets-tabs-')),seen=new Set();
process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const ok=(value,message)=>{assert.ok(value,message);checks++;};

function compile(relative){if(seen.has(relative))return;seen.add(relative);const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';compile(source);return 'from '+JSON.stringify(path.join(out,source.replace(/\.tsx?$/,'.mjs')));});fs.writeFileSync(dest,code);}
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=globalThis.testEnv;');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const u=globalThis.testUser;if(!u)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version FROM crm_members WHERE user_id=?').bind(u.userId).first();return {...u,provider:'email-otp',memberId:m?.id||'missing',memberVersion:m?.auth_version};}`);
const ROUTES=['crm','sales','kpis','kpi-evidence','kpi-evidence/import','targets','targets/history','erp-quotes'];
for(const name of ROUTES)compile('app/api/'+name+'/route.ts');
compile('lib/targets-hub.ts');
const P=await import(pathToFileURL(path.join(out,'lib/permissions.mjs'))),A=await import(pathToFileURL(path.join(out,'lib/access.mjs'))),H=await import(pathToFileURL(path.join(out,'lib/targets-hub.mjs')));
const ROLES=['admin','manager','supervisor','rep','customer_service','customer_service_manager'];
const KEYS=['targets.results','targets.collection','targets.quotes','targets.targets'],ALL_TABS=['results','sales','collection','quotes','targets'];
const HIDDEN='هذا الجزء غير متاح لحسابك. راجع مدير النظام.';
const who=(role,hidden=[])=>({role,access:P.memberAccess(role,{permissions:'{}',hidden:JSON.stringify(hidden),version:1})});

// ---- 1. The rules.
eq([...H.HIDEABLE_HUB_TABS],['results','collection','quotes','targets'],'four tabs have a switch: «نتائج الأداء»، «التحصيل»، «عروض الأسعار»، «المستهدفات والأوزان» (as GSCO\'s four performance parts)');
eq([...H.HUB_TAB_KEYS],KEYS,'stored as targets.<tab>');
ok(KEYS.every(key=>!P.PERMISSION_SCREENS.includes(key)&&!A.canViewPage('manager',key)),'no stored key is a screen: a release before this one reads none of them (every tab shows there)');
eq(P.HUB_TAB_ROWS.map(row=>[row.key,row.ar,row.en]),[['targets.results','نتائج الأداء','Performance results'],['targets.collection','التحصيل','Collection'],['targets.quotes','عروض الأسعار','Quotations'],['targets.targets','المستهدفات والأوزان','Targets & weights']],'the matrix rows, in the page\'s order, named as the tabs are');
// Who gets a switch: the roles whose targets screen is the hub, never the administrator.
eq(ROLES.map(role=>P.hubTabCeiling(role)),[true,true,true,false,false,false],'the hub: the administrator, a sales manager, a supervisor');
for(const role of ROLES){
 const kept=P.normalizePermissions(role,{hidden:[...KEYS,'targets.sales','targets.bogus','targets']}).hidden.filter(key=>key.startsWith('targets.'));
 eq(kept,['manager','supervisor'].includes(role)?KEYS:[],role+': a switch for each of the four tabs only when the targets screen is the hub, never for the administrator');
}
// Nothing hidden by default: every member sees the tabs their role sees today.
for(const role of ROLES){
 const me={role,access:P.memberAccess(role,null)};
 eq(P.hubTabsOf(me),['admin','manager','supervisor'].includes(role)?ALL_TABS:[],role+': no saved row, the five tabs as before (none without the hub)');
 eq(P.hubTabsOf({role}),P.hubTabsOf(me),role+': the same without any access read (an old offline snapshot)');
}
// An old row (saved before this change: screens only) is read as it was.
let old=P.memberAccess('manager',{permissions:JSON.stringify({'activity:edit':false}),hidden:JSON.stringify(['sales','competitors']),version:7});
eq([old.hidden,old.version],[['sales','competitors'],7],'an old row: its hidden screens, nothing more');
eq(P.hubTabsOf({role:'manager',access:old}),['results','collection','quotes','targets'],'its tabs: the four, «رفع المبيعات» gone with «المبيعات» as before');
// The order of a save: the screens, then the tabs in the page's order; junk and repeats dropped.
eq(P.normalizePermissions('supervisor',{hidden:['targets.targets','sales','targets.results','targets.results',7,'targets.quotes ']}).hidden,['sales','targets.results','targets.targets'],'screens first, tabs in order, once each; a key with a space is junk');
// Restrict-only: no stored value can show a tab the role does not have.
for(const role of ['rep','customer_service','customer_service_manager']){
 const forged={role,access:{version:1,off:[],hidden:[],viewAll:false}};
 eq(P.hubTabsOf(forged),[],role+': no hub tab, whatever is stored');
 eq(P.hubTabsBlocked({role,access:{version:1,off:[],hidden:KEYS,viewAll:false}},['results']),false,role+': a forged hidden tab changes nothing: the routes\' own role checks answer, as before');
}
const forgedAdmin={role:'admin',access:{version:1,off:[],hidden:[...KEYS,'sales','targets'],viewAll:false}};
eq([P.hubTabsOf(forgedAdmin),P.pageAllowed(forgedAdmin,'targets'),P.hubTabsBlocked(forgedAdmin,['results']),A.hubTabsAllHidden('admin',forgedAdmin.access.hidden)],[ALL_TABS,true,false,false],'the administrator is never hidden from anything, even with a forged access');
eq(P.normalizePermissions('admin',{hidden:KEYS}).hidden,[],'and nothing is stored for an administrator');
// One tab hidden: that tab goes, the others stay, in order.
for(const role of ['manager','supervisor'])for(const tab of H.HIDEABLE_HUB_TABS){
 const me=who(role,['targets.'+tab]);
 eq(P.hubTabsOf(me),ALL_TABS.filter(item=>item!==tab),role+' without '+tab+': the other four tabs');
 eq([P.hubTabHidden(me,tab),P.pageAllowed(me,'targets'),A.resolveCRMPage(role,'targets',me.access.hidden)],[true,true,'targets'],role+' without '+tab+': the screen stays');
}
// The tab to draw: the chosen one while it shows, else the first shown; nothing when the page has no tab.
eq([H.hubTabToShow('collection',['results','sales','quotes','targets']),H.hubTabToShow('results',['sales','collection']),H.hubTabToShow('quotes',['sales']),H.hubTabToShow('targets',['results','targets']),H.hubTabToShow('results',[])],['results','sales','sales','targets',null],'a hidden tab falls back to the first tab shown');
// The address and the browser's memory name a hidden tab: the first shown is drawn, and the address is put right (the memory kept).
{
 const calls=[],store=new Map();
 globalThis.window={location:{search:'?tab=collection',pathname:'/',hash:'#targets'},history:{replaceState:(data,unused,url)=>{calls.push(url);const parsed=new URL(url,'https://x.invalid');window.location.search=parsed.search;}},localStorage:{getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value)}};
 const me=who('manager',['targets.collection']),chosen=H.initialHubTab('m1'),drawn=H.hubTabToShow(chosen,P.hubTabsOf(me));
 eq([chosen,drawn],['collection','results'],'?tab=collection hidden: «نتائج الأداء» is drawn');
 H.correctHubTabAddress(drawn);eq(calls.at(-1),'/?tab=results#targets','and the address names it');
 window.location.search='';store.set('yr-targets-tab:m2','quotes');
 eq(H.hubTabToShow(H.initialHubTab('m2'),P.hubTabsOf(who('supervisor',['targets.results','targets.quotes']))),'sales','the remembered «عروض الأسعار» hidden, «نتائج الأداء» too: «رفع المبيعات», the first shown');
 H.correctHubTabAddress('sales');eq(calls.length,1,'an address that names no tab is left alone');
 eq(store.get('yr-targets-tab:m2'),'quotes','the browser keeps the member\'s choice for when the tab is shown again');
 delete globalThis.window;
}
// Every tab hidden: the page keeps «رفع المبيعات» while «المبيعات» shows; without it, the screen is hidden as if «استعراض» were off.
for(const role of ['manager','supervisor']){
 let me=who(role,KEYS);
 eq([P.hubTabsOf(me),P.pageHidden(me,'targets'),P.pageAllowed(me,'targets'),A.resolveCRMPage(role,'targets',me.access.hidden)],[['sales'],false,true,'targets'],role+': the four tabs hidden, «رفع المبيعات» left: the page stays with it');
 me=who(role,[...KEYS,'sales']);
 eq([P.hubTabsOf(me),P.pageHidden(me,'targets'),P.pageAllowed(me,'targets'),A.hubTabsAllHidden(role,me.access.hidden)],[[],true,false,true],role+': every tab and «المبيعات» hidden: the page is hidden too');
 eq([A.resolveCRMPage(role,'targets',me.access.hidden),A.resolveCRMPage(role,'reports',me.access.hidden),A.resolveCRMPage(role,'dashboard',me.access.hidden)],['activity','activity','dashboard'],role+': an old link to it (or to «التقارير») opens the first screen the member has');
 eq([P.pagesBlocked(me,['targets']),P.pagesBlocked(me,['sales','targets'])],[true,true],role+': its requests answer 404, /api/sales too (both its screens gone)');
 me=who(role,[...KEYS.slice(0,3),'sales']);
 eq([P.hubTabsOf(me),P.pageHidden(me,'targets')],[['targets'],false],role+': three of four and «المبيعات»: the page stays with its one tab');
}
eq(P.pageHidden(who('rep',['targets']),'targets'),true,'a representative\'s «أهدافي» is still hidden by its own «استعراض» only');
// A request that serves some tabs: closed only when every one of them is hidden.
const mgr=(...hidden)=>who('manager',hidden);
eq([P.hubTabsBlocked(mgr('targets.results'),['results']),P.hubTabsBlocked(mgr('targets.results'),['results','collection','quotes']),P.hubTabsBlocked(mgr('targets.results','targets.collection','targets.quotes'),['results','collection','quotes'])],[true,false,true],'the evaluation\'s evidence: open while one of its three tabs shows');
eq([P.hubTabsBlocked(mgr(),['results']),P.hubTabsBlocked(mgr('targets.collection'),['results']),P.hubTabsBlocked(mgr('targets'),['quotes']),P.hubTabsBlocked(mgr('sales'),['targets'])],[false,false,true,false],'nothing hidden; another tab hidden; the screen itself hidden (every tab goes with it); «المبيعات» hidden does not close a targets tab');
// «انسخ الصلاحيات من»: copied to a role with the hub, skipped and named for one without it.
const source={role:'manager',stored:P.normalizePermissions('manager',{hidden:['competitors','targets.collection','targets.targets']})};
let copied=P.copyPermissions(source,'supervisor');
eq([copied.stored.hidden,copied.skipped.filter(key=>key.startsWith('browse:'))],[['competitors','targets.collection','targets.targets'],[]],'manager → supervisor: the hidden tabs copied');
copied=P.copyPermissions({role:'supervisor',stored:P.normalizePermissions('supervisor',{hidden:['targets.results']})},'manager');
eq(copied.stored.hidden,['targets.results'],'supervisor → manager: copied');
copied=P.copyPermissions(source,'rep');
eq([copied.stored.hidden,copied.skipped.filter(key=>key.startsWith('browse:'))],[[],['browse:competitors','browse:targets.collection','browse:targets.targets']],'manager → representative: no tab to hide («أهدافي»), skipped');
eq(copied.skipped.filter(key=>key.startsWith('browse:targets.')).map(key=>P.permissionKeyText(key)),['المستهدفات وتقييم الأداء · التحصيل · استعراض','المستهدفات وتقييم الأداء · المستهدفات والأوزان · استعراض'],'and named in Arabic');
eq(P.permissionKeyText('browse:targets.quotes','en'),'Targets & performance · Quotations · View','and in English');
eq(P.permissionKeyText('browse:targets'),'المستهدفات وتقييم الأداء · استعراض','the screen\'s own key as before');
copied=P.copyPermissions(source,'admin');
eq([copied.stored.hidden,copied.skipped.filter(key=>key.startsWith('browse:targets.'))],[[],['browse:targets.collection','browse:targets.targets']],'→ administrator: nothing hidden, the tabs listed as skipped');
copied=P.copyPermissions({role:'manager',stored:P.normalizePermissions('manager',{hidden:KEYS})},'customer_service');
eq(copied.stored.hidden,[],'→ customer service: nothing (no targets screen)');
// What the member is sent and the matrix starts from (storedFromAccess) keeps the tabs.
eq(P.storedFromAccess('supervisor',who('supervisor',['targets.quotes','sales']).access).hidden,['sales','targets.quotes'],'the access sent to the page keeps them');

// ---- 2. The routes on an isolated database.
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const name of fs.readdirSync(path.join(root,'drizzle')).filter(file=>/^\d+.*\.sql$/.test(file)).sort())sql.exec(fs.readFileSync(path.join(root,'drizzle',name),'utf8'));
class Statement{constructor(q,a=[]){this.q=q;this.a=a;}bind(...a){return new Statement(this.q,a);}async run(){const r=sql.prepare(this.q).run(...this.a);return{meta:{changes:Number(r.changes)}};}async all(){return{results:sql.prepare(this.q).all(...this.a)};}async first(){return sql.prepare(this.q).get(...this.a)||null;}}
const DB={prepare:q=>new Statement(q),batch:async statements=>{sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(/^\s*(SELECT|WITH)/i.test(s.q)?{...await s.all(),meta:{changes:0}}:await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid'};
const now=new Date().toISOString(),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),month=day.slice(0,7);
const member=(id,role,supervisor=null)=>sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,1,0,?)').run(id,'u-'+id,id+'@yourrest.org','اسم '+id,role,'الرئيسي',supervisor,'all',now);
member('owner','admin');member('mgr','manager');member('mgr2','manager');member('sup','supervisor','mgr');member('rep1','rep','sup');member('cs','customer_service','mgr');
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-owner')").run();
const user=id=>{globalThis.testUser=id?{userId:'u-'+id,email:id+'@yourrest.org',fullName:id}:null;};
const route=name=>import(pathToFileURL(path.join(out,'app/api/'+name+'/route.mjs')));
const R=Object.fromEntries(await Promise.all(ROUTES.map(async name=>[name,await route(name)])));
const send=async(handler,{as,body,url})=>{user(as);const request=body===undefined?new Request('https://test.invalid'+url):new Request('https://test.invalid'+url,{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json'},body:JSON.stringify(body)});const response=await handler(request);const text=await response.text();let data={};try{data=JSON.parse(text);}catch{/* not JSON */}return{status:response.status,data};};
const state=async as=>(await send(R.crm.GET,{as,url:'/api/crm'})).data;
let versions={};
const save=async(memberId,hidden,status=200,as='owner')=>{const answer=await send(R.crm.POST,{as,url:'/api/crm',body:{action:'permissions',memberId,version:versions[memberId]||0,cells:{},hidden,viewAll:false,requestId:crypto.randomUUID()}});eq(answer.status,status,'save '+memberId+' '+JSON.stringify(hidden)+' as '+as+' -> '+JSON.stringify(answer.data).slice(0,200));if(answer.status===200)versions[memberId]=answer.data.permissions.version;return answer.data;};
// Each tab's requests, each answered past the permission checks by a request the route then refuses on its own (or serves).
const asks={
 kpis:as=>send(R.kpis.POST,{as,url:'/api/kpis',body:{}}),
 evidenceGet:as=>send(R['kpi-evidence'].GET,{as,url:'/api/kpi-evidence?memberId=rep1&month='+month}),
 evidencePost:as=>send(R['kpi-evidence'].POST,{as,url:'/api/kpi-evidence',body:{}}),
 collectionGet:as=>send(R['kpi-evidence/import'].GET,{as,url:'/api/kpi-evidence/import'}),
 collectionPost:as=>send(R['kpi-evidence/import'].POST,{as,url:'/api/kpi-evidence/import',body:{}}),
 quotesGet:as=>send(R['erp-quotes'].GET,{as,url:'/api/erp-quotes'}),
 quotesPost:as=>send(R['erp-quotes'].POST,{as,url:'/api/erp-quotes',body:{}}),
 targetsPost:as=>send(R.targets.POST,{as,url:'/api/targets',body:{}}),
 history:as=>send(R['targets/history'].GET,{as,url:'/api/targets/history?scopeId=rep1'}),
 sales:as=>send(R.sales.GET,{as,url:'/api/sales?month='+month+'&kpis=1'}),
};
const TAB_ASKS={results:['kpis'],collection:['collectionGet','collectionPost'],quotes:['quotesGet','quotesPost'],targets:['targetsPost','history']};
const hidden=(answer,label)=>eq([answer.status,answer.data.error],[404,HIDDEN],label+' -> '+answer.status+' '+JSON.stringify(answer.data).slice(0,160));
const open=(answer,label)=>ok([200,400].includes(answer.status)&&answer.data.error!==HIDDEN,label+' is not closed -> '+answer.status+' '+JSON.stringify(answer.data).slice(0,160));
// Release day: nothing saved, every request of every tab answers as before for the manager.
const EXPECTED={kpis:400,evidenceGet:200,evidencePost:400,collectionGet:200,collectionPost:400,quotesGet:200,quotesPost:400,targetsPost:400,history:200,sales:200};
eq(Object.fromEntries(await Promise.all(Object.entries(asks).map(async([name,ask])=>[name,(await ask('mgr')).status]))),EXPECTED,'release day: every request past the permissions (200, or 400 for an empty body the route\'s own schema refuses)');
const baseline=Object.fromEntries(await Promise.all(Object.entries(asks).map(async([name,ask])=>[name,(await ask('mgr2')).status])));
ok((await asks.sales('mgr')).data.kpis,'release day: /api/sales carries the evaluation');
// Who saves: the administrator only; within the role (a representative and customer service keep nothing).
for(const as of ['mgr','sup','rep1'])await save('rep1',KEYS,403,as);
eq((await save('rep1',KEYS)).permissions.hidden,[],'a representative: no tab stored');
eq((await save('cs',KEYS)).permissions.hidden,[],'customer service: none');
eq((await save('owner',KEYS)).permissions.hidden,[],'the administrator: none');
// One tab at a time: its own requests 404, every other one as before; another manager untouched.
for(const tab of H.HIDEABLE_HUB_TABS){
 const saved=await save('mgr',['targets.'+tab]);
 eq(saved.permissions.hidden,['targets.'+tab],'saved: '+tab);
 eq((await state('mgr')).me.access.hidden,['targets.'+tab],'the member\'s next load carries it');
 for(const [name,ask] of Object.entries(asks)){const answer=await ask('mgr');if(TAB_ASKS[tab].includes(name))hidden(answer,tab+' hidden: '+name);else open(answer,tab+' hidden: '+name);}
 for(const name of TAB_ASKS[tab])eq((await asks[name]('mgr2')).status,baseline[name],tab+' hidden from mgr: mgr2\'s '+name+' as before');
 ok((await asks.sales('mgr')).data.kpis,tab+' hidden: the shared read still carries the evaluation for the other tabs');
}
// The three evaluation tabs hidden: «بيانات المؤشرات» closes, /api/sales serves the rest without the evaluation.
await save('mgr',['targets.results','targets.collection','targets.quotes']);
for(const name of ['kpis','evidenceGet','evidencePost','collectionGet','quotesGet'])hidden(await asks[name]('mgr'),'the three hidden: '+name);
for(const name of ['targetsPost','history'])open(await asks[name]('mgr'),'the three hidden: '+name);
let read=await asks.sales('mgr');
eq([read.status,read.data.kpis,Array.isArray(read.data.sales),!!read.data.targets],[200,null,true,true],'/api/sales?kpis=1: served, the evaluation left out, the sales and targets kept');
ok((await asks.sales('mgr2')).data.kpis,'another manager still receives it');
// Every tab hidden, «المبيعات» shown: the page stays with «رفع المبيعات»; its sales read stays, nothing of the tabs.
await save('mgr',KEYS);
for(const name of Object.keys(asks).filter(name=>name!=='sales'))hidden(await asks[name]('mgr'),'every tab hidden: '+name);
read=await asks.sales('mgr');eq([read.status,read.data.kpis],[200,null],'every tab hidden, «المبيعات» shown: /api/sales serves «رفع المبيعات» and the sales page');
// And «المبيعات» hidden too: the screen goes; /api/sales answers 404 (both its screens gone).
await save('mgr',['sales',...KEYS]);
hidden(await asks.sales('mgr'),'every tab and «المبيعات» hidden: /api/sales');
eq((await state('mgr')).me.access.hidden,['sales',...KEYS],'the page learns it from the member\'s access');
// The screen itself hidden: every tab's request is closed with it (the ERP quotations import too: its button is on the hub only).
await save('mgr',['targets']);
for(const name of Object.keys(asks).filter(name=>name!=='sales'))hidden(await asks[name]('mgr'),'the screen hidden: '+name);
read=await asks.sales('mgr');eq([read.status,read.data.kpis],[200,null],'the screen hidden, «المبيعات» shown: the sales page\'s read, without the evaluation');
// A supervisor: its own tabs.
await save('sup',['targets.targets']);
hidden(await asks.history('sup'),'the supervisor without «المستهدفات والأوزان»: its history');
open(await asks.evidenceGet('sup'),'the supervisor still reads «بيانات المؤشرات»');
ok((await asks.sales('sup')).data.kpis,'and the evaluation');
// Showing everything again: as on release day.
await save('mgr',[]);await save('sup',[]);
for(const [name,ask] of Object.entries(asks))open(await ask('mgr'),'shown again: '+name);
// Every save on the record with before and after (the «صلاحيات» history entry).
const audit=sql.prepare("SELECT record_id,detail FROM crm_audit WHERE action='صلاحيات' AND record_id='mgr' ORDER BY created_at").all().map(row=>JSON.parse(row.detail));
eq(audit.length,9,'nine saves of the manager, nine entries');
eq([audit[0].before.hidden,audit[0].after.hidden],[[],['targets.results']],'the first: before nothing hidden, after «نتائج الأداء»');
eq([audit[5].before.hidden,audit[5].after.hidden],[['targets.results','targets.collection','targets.quotes'],KEYS],'every tab hidden: before and after');
ok(!(await state('owner')).audits.some(entry=>entry.action==='صلاحيات'),'kept out of the recent changes, as every permissions entry');
console.log(JSON.stringify({ok:true,checks,syntheticFixtures:true,productionDataUsed:false}));
