// Customer service in the sales process on the server, unit by unit (the owner's unit-test plan, 2026-11-22): lib/service-sales-server.ts
// called directly (no build, no HTTP: tests/service-sales*-http.mjs cover the routes) on an in-memory SQLite with every migration and the
// real context (lib/crm-server.ts), compiled into .sites-runtime so the coverage measure sees it, the clock fixed in Riyadh. The month and
// the page asked for (Riyadh's midnight, wrong values), the share of the full customer-service sales of a report (voids, returns, cents),
// the teams each role sees (an orphan member, an inactive one, a sales manager with no team), the facts of the opportunities, the warning
// of an open sales opportunity, the routing facts (no ERP code, dormant, the lead), the support-sales window (default, saved), the full
// sales left out of every achievement (none while customer service keeps nothing; the kept opportunity's invoice; the cache of a
// request), the conversion facts, the lists of «مصادر الفرص» (lost, dormant and never bought, search, branch, an open opportunity, pages),
// the record an opportunity starts from and the lead of a new one (each refusal), the dashboard (who; an empty one; the full sale and the
// opportunities) and its Excel file in both languages (a name that starts like a formula stays text), and the role tasks (who sees them,
// recorded once, every refusal). Made-up members, customers and amounts only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import {unzipSync,strFromU8} from 'fflate';

const NativeDate=Date;let clock=NativeDate.parse('2026-11-16T09:00:00.000Z');// 12:00 in Riyadh
globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'service-sales-server-unit-')),seen=new Set();process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
fs.writeFileSync(path.join(out,'env.mjs'),'export const env=new Proxy({},{get:(_,key)=>globalThis.testEnv?.[key]});');
fs.writeFileSync(path.join(out,'auth.mjs'),`export async function getApplicationUser(){const id=globalThis.testIdentity;if(!id)return null;const m=await globalThis.testEnv.DB.prepare('SELECT id,auth_version,email FROM crm_members WHERE id=?').bind(id).first();return {memberId:m?.id,memberVersion:m?.auth_version,email:m?.email};}`);
function compile(relative){
 if(seen.has(relative))return;seen.add(relative);
 const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});
 let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{fileName:relative,compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
  if(imp==='cloudflare:workers')return 'from '+JSON.stringify(path.join(out,'env.mjs'));
  if(imp==='@/app/application-auth')return 'from '+JSON.stringify(path.join(out,'auth.mjs'));
  if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
  let rel=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
  if(/\.json$/.test(rel)){const target=path.join(out,rel);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,rel),target);return 'from '+JSON.stringify(target)+' with {type:"json"}';}
  if(!/\.tsx?$/.test(rel))rel+=fs.existsSync(path.join(root,rel+'.ts'))?'.ts':'.tsx';
  compile(rel);return 'from '+JSON.stringify(path.join(out,rel.replace(/\.tsx?$/,'.mjs')));
 });
 fs.writeFileSync(dest,code);
}
const load=relative=>{compile(relative);return import(path.join(out,relative.replace(/\.tsx?$/,'.mjs')));};
const S=await load('lib/service-sales-server.ts'),server=await load('lib/crm-server.ts'),R=await load('lib/service-sales.ts'),K=await load('lib/service-kpi.ts');
let checks=0;
const plain=v=>v===undefined?v:JSON.parse(JSON.stringify(v));
const eq=(a,b,m)=>{assert.deepEqual(plain(a),plain(b),m);checks++;},ok=(v,m)=>{assert.ok(v,m);checks++;};
const refusal=async(promise,status,pattern,message)=>{let error;try{await promise;}catch(e){error=e;}ok(error instanceof server.CRMError&&error.status===status&&pattern.test(error.message),message+' ('+(error?.status??'none')+': '+(error?.message||'no error')+')');};

// ---------------------------------------------------------------------------------------------------- the pure parts
const url=query=>new URL('https://test.invalid/api/service-performance'+query);
eq([S.requestedMonth(url(''),'2026-11-16T09:00:00.000Z'),S.requestedMonth(url('?month=2026-02'),'x'),S.requestedMonth(url(''),'2026-11-30T20:59:59.000Z'),S.requestedMonth(url(''),'2026-11-30T21:00:00.000Z')],['2026-11','2026-02','2026-11','2026-12'],'the month asked, else Riyadh\'s month of now (21:00 UTC on the 30th is December there)');
for(const month of ['2026-13','2026-00','2026-1','26-11','2026-11-01','٢٠٢٦-١١',' 2026-11'])await refusal(Promise.resolve().then(()=>S.requestedMonth(url('?month='+encodeURIComponent(month)),'2026-11-16T09:00:00.000Z')),400,/اختر شهرًا صحيحًا/,'a month refused: '+month);
eq(['1','2','100000',null,'','0','-1','1.5','abc','100001','1e3','٢'].map(S.requestedPage),[1,2,100000,1,1,1,1,1,1,1,1000,1],'the page: a whole number from 1 to 100000, else the first (1e3 reads as 1000)');
eq(S.riyadhToday(),'2026-11-16','today in Riyadh');
clock=NativeDate.parse('2026-11-15T21:00:00.000Z');eq(S.riyadhToday(),'2026-11-16','21:00 UTC is already tomorrow in Riyadh');clock=NativeDate.parse('2026-11-16T09:00:00.000Z');
const sales=[{id:'a',totalCents:115000,documentType:'sale'},{id:'b',totalCents:-23000,documentType:'return'},{id:'c',totalCents:99999,status:'void'},{id:'d',totalCents:1}];
eq([S.fullServiceShare(sales,null),S.fullServiceShare(sales,new Set())],[{total:0,invoices:0,ids:[]},{total:0,invoices:0,ids:[]}],'nothing excluded: nothing');
eq(S.fullServiceShare(sales,new Set(['a','b','c','x'])),{total:920,invoices:1,ids:['a','b']},'the excluded documents of the list: a return deducts and is not an invoice, a void one is left out');
eq(S.fullServiceShare([{id:'d',totalCents:1},{id:'e',totalCents:2}],new Set(['d','e'])).total,0.03,'cents summed before they are divided');

const M=(id,name,role,supervisorId='',active=1)=>({id,name,role,supervisorId,active,branch:'الرئيسي',email:id+'@example.invalid',target:0});
const team=[M('admin','مدير النظام','admin'),M('mgr','مدير المبيعات','manager'),M('mgr2','مدير بلا فريق','manager'),M('csm','مدير خدمة العملاء','customer_service_manager','mgr'),M('cs','ممثل أول','customer_service','csm'),M('cs2','ممثل غادر','customer_service','csm',0),M('csx','ممثل بلا مدير','customer_service'),M('rep','المندوب','rep','sup')];
const teams=me=>S.performanceTeams(team.find(m=>m.id===me),team).map(g=>[g.managerId,g.members.map(m=>m.id)]);
eq(teams('admin'),[['csm',['csm','cs']],['',['csx']]],'the administrator: every team, the members with no manager last, an inactive member left out');
eq(teams('mgr'),[['csm',['csm','cs']]],'a sales manager: the teams whose manager reports to him');
eq(teams('mgr2'),[],'a sales manager no team reports to: none');
eq(teams('csm'),[['csm',['csm','cs']]],'a customer-service manager: their team');
eq(teams('cs'),[['csm',['cs']]],'a member: themselves, under their manager');
eq(S.performanceTeams(team.find(m=>m.id==='cs2'),team).map(g=>g.members.map(m=>m.id)),[['cs2']],'an inactive member still sees themselves');

// ---------------------------------------------------------------------------------------------------- the database
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+f,'utf8'));
sql.exec('CREATE TABLE yr_schema_migrations(name TEXT PRIMARY KEY NOT NULL,sha256 TEXT NOT NULL,applied_at TEXT NOT NULL)');
sql.prepare("INSERT INTO yr_schema_migrations VALUES('0021_service_sales_process.sql','x','2026-11-01T00:00:00.000Z')").run();
class Statement{constructor(q,a=[]){this.q=q;this.a=a;}bind(...a){return new Statement(this.q,a);}async run(){const result=sql.prepare(this.q).run(...this.a);return {meta:{changes:Number(result.changes)}};}async all(){return {results:sql.prepare(this.q).all(...this.a)};}async first(){return sql.prepare(this.q).get(...this.a)||null;}}
const DB={prepare:q=>new Statement(q),batch:async statements=>{sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
globalThis.testEnv={DB,YR_APP_ORIGIN:'https://test.invalid'};
for(const m of [...team,M('sup','المشرف','supervisor','mgr')])sql.prepare('INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,region_scope,active,target,created_at) VALUES(?,?,?,?,?,?,?,?,?,0,?)').run(m.id,'u-'+m.id,m.email,m.name,m.role,m.branch,m.supervisorId||null,'all',m.active,'2025-01-01');
sql.prepare("INSERT INTO crm_settings(id,owner_id) VALUES('company','u-admin')").run();
const insert=(id,kind,parent,assigned,data,when='2025-06-01T08:00:00.000Z',branch='الرئيسي')=>sql.prepare("INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version,mutation_id) VALUES(?,?,?,?,?,?,?,?,1,'fixture')").run(id,kind,parent,assigned,branch,JSON.stringify(data),when,when);
const cust=(id,code,name=id,branch='الرئيسي')=>insert(id,'customer',null,'rep',{name,code,region:'الشرقية',city:'الدمام',phone:'05000000'+String(10+checks%80),branch,assignedTo:'rep'},'2025-06-01T08:00:00.000Z',branch);
cust('c-dorm','C-DORM','مصنع منقطع');cust('c-buy','C-BUY','مصنع يشتري');cust('c-never','C-NEVER','مصنع لم يشتر');cust('c-nocode','','مصنع بلا كود');cust('c-lost','C-LOST','مصنع مفقود');cust('c-held','C-HELD','=HYPERLINK("x")');cust('c-far','C-FAR','مصنع جدة','جدة');cust('c-open','C-OPEN','مصنع له فرصة');
sql.prepare("INSERT INTO crm_erp_imports(id,actor_id,fingerprint,file_name,result,created_at) VALUES('erp-1','admin','f','sales.xlsx','{}','2026-11-01T00:00:00.000Z')").run();
const erp=(id,code,date,cents,refs=[],type='sale',imported='2026-11-05T09:00:00.000Z')=>sql.prepare("INSERT INTO crm_erp_sales(id,document_key,content_hash,mapped_hash,reference,document_type,date,employee_id,rep_id,branch,region_scope,customer_code,customer_name,data,total_cents,import_id,created_by,created_at) VALUES(?,?,'h','m',?,?,?,'E-1','rep','الرئيسي','all',?,'عميل',?,?,'erp-1','admin',?)").run(id,'k-'+id,'INV-'+id,type,date,code,JSON.stringify({items:[],...(refs.length?{quotationRefs:refs}:{})}),cents,imported);
erp('old-dorm','C-DORM','2026-07-01',10000);erp('recent','C-BUY','2026-11-06',10000);erp('old-open','C-OPEN','2026-05-01',10000);
const kase=(id,customer,status,data={},extra={})=>sql.prepare('INSERT INTO crm_service_cases(id,customer_id,status,creator_id,service_manager_id,sales_manager_id,assigned_to,supervisor_id,data,created_at,updated_at,version,mutation_id,lead_group,lead_source,lead_note,route,routed_by,routed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?)')
 .run(id,customer,status,extra.creator||'cs','csm','mgr','assigned' in extra?extra.assigned:'rep',null,JSON.stringify({participants:['cs','csm'],registration:{type:'call',visitNumber:extra.number??70},...data}),extra.created||'2026-11-01T08:00:00.000Z','2026-11-01T08:00:00.000Z','fixture',extra.leadGroup??null,extra.leadSource??null,'',extra.route??null,extra.route?'csm':null,extra.routedAt??null);

const as=async id=>{globalThis.testIdentity=id;return server.context();};
// Before customer service keeps anything: nothing to leave out, nothing read
eq(await S.fullServiceSaleIds(DB),null,'no opportunity kept by customer service: null, nothing else read');
eq(await S.readSupportSalesDays(DB),R.SUPPORT_SALES_DAYS,'the support-sales window: 30 days by default');
const settings=days=>{sql.prepare('DELETE FROM crm_records WHERE id=?').run(K.SERVICE_KPI_SETTINGS_ID);insert(K.SERVICE_KPI_SETTINGS_ID,K.SERVICE_KPI_SETTINGS_KIND,null,'admin',{supportSalesDays:days});};
settings(45);eq(await S.readSupportSalesDays(DB),45,'the administrator\'s window');
settings(400);eq(await S.readSupportSalesDays(DB),R.SUPPORT_SALES_DAYS,'a window over 365 days: the default');
settings(2.5);eq(await S.readSupportSalesDays(DB),R.SUPPORT_SALES_DAYS,'a fraction of a day: the default');
sql.prepare('DELETE FROM crm_records WHERE id=?').run(K.SERVICE_KPI_SETTINGS_ID);

// The opportunities: one lost with sales, one kept by customer service and won, one open
kase('case-lost','c-lost','assigned',{},{number:71});
insert('k-lost','activity','c-lost','rep',{type:'call',date:'2026-11-12',result:'رفض',salesStage:'lost',lossReason:'السعر أعلى من المنافس',serviceCaseId:'case-lost',performedBy:'rep',responsibleId:'rep'},'2026-11-12T08:00:00.000Z');
kase('case-held','c-held','service',{serviceStages:[{stage:'won',lossReason:'',note:'تم',by:'cs',at:'2026-11-10T10:00:00.000Z'}]},{assigned:'cs',route:'service',routedAt:'2026-11-02T08:00:00.000Z',number:72,leadGroup:'service',leadSource:'واتساب'});
kase('case-open','c-open','pending_approval',{},{assigned:null,number:73});
insert('q-held','quote','c-held','cs',{number:'Qut-77',date:'2026-11-03',status:'sent',total:1150});
erp('erp-full','C-HELD','2026-11-05',115000,['Qut-77']);
erp('erp-before','C-HELD','2026-11-02',50000,['Qut-77']);// before the quotation: never its sale
erp('erp-return','C-HELD','2026-11-07',-15000,[],'return');// a return naming no quotation follows the full sale
const full=await S.fullServiceSaleIds(DB);
eq([...full].sort(),['erp-full','erp-return'],'the full customer-service sales: the kept opportunity\'s invoice of its quotation, and the return that follows it');
const admin=await as('admin');
const cached=S.serviceSalesExclusion(admin);
ok(cached===S.serviceSalesExclusion(admin)&&cached!==S.serviceSalesExclusion(await as('admin')),'read once for a request (the same context), again for another');
eq([...(await cached)].sort(),['erp-full','erp-return'],'and the same set');
const conversion=await S.loadConversionFacts(DB,admin.members);
eq(conversion.map(c=>[c.caseId,c.memberId,c.won,c.invoiced,c.closedAt]).sort(),[['case-held','cs',true,true,'2026-11-10T10:00:00.000Z'],['case-lost','cs',false,false,'2026-11-12T08:00:00.000Z']],'the closed opportunities: whose, won or lost, invoiced');

// caseFacts and the warning of an open sales opportunity
const facts=S.caseFacts(admin.serviceCases,admin.all,admin.members);
eq(facts.map(f=>[f.id,f.number,f.customerName,f.registrarId,f.ownerId,f.held,f.route,f.approved,f.state,f.leadGroup,f.leadSource,f.routedAt]).sort(),[
 ['case-held',72,'=HYPERLINK("x")','cs','cs',true,'service',false,'won','service','واتساب','2026-11-02T08:00:00.000Z'],
 ['case-lost',71,'مصنع مفقود','cs','rep',false,null,false,'lost',null,null,''],
 ['case-open',73,'مصنع له فرصة','cs','',false,null,false,'pending_approval',null,null,'']],'the facts of each opportunity');
const openCase=admin.serviceCases.find(s=>s.id==='case-open');
eq(S.openSalesWarnings({all:admin.all,members:admin.members},openCase),[],'no sales opportunity: no warning');
const withVisit=[...admin.all,{id:'v1',kind:'activity',parentId:'c-open',assignedTo:'rep',branch:'الرئيسي',data:{type:'visit',date:'2026-11-14',salesStage:'negotiation',performedBy:'rep'},createdAt:'2026-11-14T08:00:00.000Z',updatedAt:'',version:1},{id:'o1',kind:'opportunity',parentId:'c-open',assignedTo:'sup',branch:'الرئيسي',data:{stage:'proposal',nextDate:'2026-11-20'},createdAt:'',updatedAt:'',version:1},{id:'o2',kind:'opportunity',parentId:'c-open',assignedTo:'rep',branch:'الرئيسي',data:{stage:'won'},createdAt:'',updatedAt:'',version:1}];
eq(S.openSalesWarnings({all:withVisit,members:admin.members},openCase),[{kind:'visit',stage:'negotiation',ownerName:'المندوب',date:'2026-11-14'},{kind:'request',stage:'proposal',ownerName:'المشرف',date:'2026-11-20'}],'a sales visit at an open stage and an open mold request: two warnings (a won request none)');
eq(S.openSalesWarnings({all:[...withVisit.slice(0,-3),{...withVisit.at(-3),data:{...withVisit.at(-3).data,salesStage:'won'}}],members:admin.members},openCase),[],'the latest sales visit closed: no warning');
// The routing facts
eq(await S.routingFactsOf(admin,openCase),{unlinked:false,dormant:true,serviceEffort:false},'a customer with a code whose last purchase is older than 90 days: dormant');
eq(await S.routingFactsOf(admin,{...openCase,customerId:'c-nocode'}),{unlinked:true,dormant:true,serviceEffort:false},'no ERP code: unlinked (and never bought)');
eq(await S.routingFactsOf(admin,{...openCase,customerId:'c-buy',leadGroup:'service'}),{unlinked:false,dormant:false,serviceEffort:true},'bought ten days ago; the lead brought in by customer service');
eq(await S.routingFactsOf(admin,{...openCase,customerId:'gone'}),{unlinked:true,dormant:true,serviceEffort:false},'a customer that is not there: unlinked');
await refusal(S.routingView(await as('cs'),'nothing'),404,/الطلب غير متاح/,'routing of an opportunity that is not there: 404');
await refusal(S.routingView(await as('csm'),'case-held'),409,/ليست بانتظار اعتمادك/,'routing of an opportunity not waiting for this reader: 409');

// «مصادر الفرص»
const cs=await as('cs');
const dormant=await S.leadList(cs,'dormant','');
eq([dormant.total,dormant.lapsed,dormant.never,dormant.rows.map(r=>[r.id,r.lastPurchase,r.neverBought])],[4,1,3,[['c-dorm','2026-07-01',false],['c-nocode','',true],['c-never','',true],['c-lost','',true]]],'dormant: the lapsed first, then those who never bought (by name in Arabic order; a customer whose opportunity closed is listed again); the branch\'s only, none with an open opportunity, none who bought within 90 days');
ok(!dormant.rows.some(r=>['c-far','c-open','c-buy','c-held'].includes(r.id)),'another branch, an open opportunity and the recent buyers (c-held bought on the 5th) are not listed');
eq((await S.leadList(cs,'dormant','  منقطع  ')).rows.map(r=>r.id),['c-dorm'],'the search, trimmed');
eq((await S.leadList(cs,'dormant','C-NEV')).rows.map(r=>r.id),['c-never'],'by code, any case');
const page2=await S.leadList(cs,'dormant','',2,2);
eq([page2.page,page2.rows.map(r=>r.id),page2.total],[2,['c-never','c-lost'],4],'a page of two: the second page');
eq((await S.leadList(cs,'dormant','',1,Infinity)).rows.length,4,'the export asks every row');
const lost=await S.leadList(cs,'lost','');
eq(lost.rows.map(r=>[r.id,r.number,r.customerName,r.lossReason,r.lostAt,r.holderName,r.registrarName]),[['case-lost',71,'مصنع مفقود','السعر أعلى من المنافس','2026-11-12T08:00:00.000Z','المندوب','ممثل أول']],'lost opportunities to win back, with the loss reason and who held and registered it');
eq((await S.leadList(cs,'lost','غير موجود')).total,0,'a search that matches nothing');
// The record an opportunity starts from
await refusal(as('rep').then(c=>S.resolveLeadReference(c,'customer','c-dorm')),403,/مصادر الفرص متاحة/,'a representative: 403');
eq(await S.resolveLeadReference(cs,'customer','c-dorm'),{kind:'customer',id:'c-dorm',source:R.systemLeadSources.customer,label:'مصنع منقطع',customerId:'c-dorm',customerName:'مصنع منقطع',blocked:''},'a dormant customer: its source filled in by the system');
await refusal(S.resolveLeadReference(cs,'customer','c-buy'),409,/اشترى خلال 90 يومًا/,'a customer who bought within 90 days');
await refusal(S.resolveLeadReference(cs,'customer','c-far'),404,/العميل غير متاح لك/,'a customer of another branch: 404');
await refusal(S.resolveLeadReference(cs,'customer','nobody'),404,/العميل غير متاح لك/,'a customer that is not there: 404');
eq((await S.resolveLeadReference(cs,'customer','c-open')).blocked.length>0,true,'a customer with an open opportunity: blocked, with the reason');
eq((({label,customerId,blocked})=>[label,customerId,blocked])(await S.resolveLeadReference(cs,'opportunity','case-lost')),['#71 · مصنع مفقود','c-lost',''],'a lost opportunity');
await refusal(S.resolveLeadReference(cs,'opportunity','case-held'),409,/من فرصة مفقودة فقط/,'a won opportunity is not a source');
await refusal(S.resolveLeadReference(cs,'opportunity','nothing'),404,/الفرصة غير متاحة لك/,'an opportunity that is not there');
await refusal(S.resolveLeadReference(cs,'support','nothing'),404,/الطلب غير متاح لك/,'a support request that is not there');
await refusal(S.resolveLeadReference(cs,'complaint','nothing'),404,/الشكوى غير متاحة لك/,'a complaint that is not there');
// The lead of a new opportunity
eq(await S.intakeLead(cs,undefined,false,'c-dorm'),null,'an older page without the field: «غير محدد» (null)');
for(const raw of [null,undefined])await refusal(S.intakeLead(cs,raw,true,'c-dorm'),400,/اختر مصدر الفرصة\./,'the field sent empty');
for(const raw of [{group:'other'},{group:'service',source:'x'.repeat(81)},{group:'service',extra:1},'واتساب'])await refusal(S.intakeLead(cs,raw,true,'c-dorm'),400,/اختر مصدر الفرصة من القائمة/,'not a lead: '+JSON.stringify(raw));
eq(await S.intakeLead(cs,{group:'service',source:'واتساب',note:'يُهمل'},true,'c-dorm'),{group:'service',source:'واتساب',note:'',refKind:null,refId:null},'a source picked: its note dropped');
eq(await S.intakeLead(cs,{group:'service',source:R.LEAD_OTHER,note:'  معرض محلي  '},true,'c-dorm'),{group:'service',source:R.LEAD_OTHER,note:'معرض محلي',refKind:null,refId:null},'«أخرى»: its note kept, trimmed');
await refusal(S.intakeLead(cs,{group:'service',source:R.LEAD_OTHER,note:''},true,'c-dorm'),400,/./,'«أخرى» without a note');
await refusal(S.intakeLead(cs,{group:'service',source:'مصدر غير موجود'},true,'c-dorm'),400,/./,'a source that is not in the list');
eq(await S.intakeLead(cs,{group:'system',refKind:'customer',refId:'c-dorm'},true,'c-dorm'),{group:'system',source:R.systemLeadSources.customer,note:'',refKind:'customer',refId:'c-dorm'},'from the system: the source filled in');
await refusal(S.intakeLead(cs,{group:'system',refKind:'customer',refId:'c-dorm',source:'واتساب'},true,'c-dorm'),400,/يحدده النظام/,'another source written for a system lead');
await refusal(S.intakeLead(cs,{group:'system',refKind:'opportunity',refId:'case-lost'},true,'c-dorm'),400,/اختر عميل السجل/,'the record of another customer');

// A support request and a complaint as the record an opportunity starts from (and the support contact behind a sale)
cust('c-sup','C-SUP','مصنع طلب تواصل');cust('c-cmp','','مصنع شكوى');
insert('support-1','support',null,'rep',{kind:'support',customerId:'c-sup',origin:'rep',status:'done',requestedBy:'rep',requestedAt:'2026-11-07T08:00:00.000Z',repId:'rep',note:'متابعة',channel:'any',handlerId:'cs',handlerAt:'2026-11-07T09:00:00.000Z',handlerBy:'cs',result:{outcome:'reached_interested',note:'مهتم',nextDate:'',by:'cs',at:'2026-11-08T08:00:00.000Z'},events:[]},'2026-11-07T08:00:00.000Z');
insert('complaint-1','complaint',null,'cs',{kind:'complaint',customerId:'c-cmp',status:'closed',registrarId:'cs',serviceManagerId:'csm',salesManagerId:'',supervisorId:'',assigneeId:'',channel:'call',category:'quality',severity:'normal',description:'شكوى',demand:'',reference:'',contactName:'أحمد',contactPhone:'0500000002',complaintNumber:7,events:[]},'2026-11-07T08:00:00.000Z');
erp('erp-sup','C-SUP','2026-11-10',20000);// ten days after the support contact: a support-assisted sale
const cs2=await as('cs');
eq((({kind,source,label,customerId,blocked})=>[kind,source,label,customerId,blocked])(await S.resolveLeadReference(cs2,'support','support-1')),['support',R.systemLeadSources.support,'مصنع طلب تواصل','c-sup',''],'a support request: its source and customer');
await refusal(S.resolveLeadReference(cs2,'missed_visit','support-1'),409,/نوع الطلب لا يطابق مصدر الفرصة/,'a support request is not a missed visit');
eq((({source,label,customerId})=>[source,label,customerId])(await S.resolveLeadReference(cs2,'complaint','complaint-1')),[R.systemLeadSources.complaint,'#7 · مصنع شكوى','c-cmp'],'a complaint: its number and customer');

// The dashboard
await refusal(as('rep').then(c=>S.performanceView(c,'2026-11','2026-11-16T09:00:00.000Z')),403,/أداء خدمة العملاء متاح/,'a representative: 403');
eq(await S.performanceView(await as('mgr2'),'2026-11','2026-11-16T09:00:00.000Z'),{generatedAt:'2026-11-16T09:00:00.000Z',month:'2026-11',supportDays:30,note:R.performanceNote,reach:'reporting',teams:[],invoices:[],opportunities:[]},'a sales manager no team reports to: an empty answer');
const view=await S.performanceView(admin,'2026-11','2026-11-16T09:00:00.000Z');
eq([view.reach,view.teams.map(t=>[t.managerId,t.rows.map(r=>r.memberId)])],['all',[['csm',['csm','cs']],['',['csx']]]],'the administrator: every team');
eq(view.invoices.map(i=>[i.number,i.type,i.category,i.memberName,i.value,i.caseNumber]),[['INV-erp-full','sale','full','ممثل أول',1150,72],['INV-erp-return','return','full','ممثل أول',-150,72],['INV-erp-sup','sale','support','ممثل أول',200,null]],'the full sale and the return that follows it, with their opportunity, and a sale ten days after a support contact, credited to the handler');
eq(view.opportunities.map(o=>[o.number,o.customerName,o.hidden,o.registrarName,o.route,o.state]).sort((a,b)=>a[0]-b[0]),[[71,'مصنع مفقود',false,'ممثل أول','','lost'],[72,'=HYPERLINK("x")',false,'ممثل أول','service','won'],[73,'مصنع له فرصة',false,'ممثل أول','','pending_approval']],'the opportunities registered in the month by the members shown');
eq((await S.performanceView(admin,'2026-10','2026-11-16T09:00:00.000Z')).invoices,[],'another month: none of them');
const mine=await S.performanceView(cs,'2026-11','2026-11-16T09:00:00.000Z');
eq([mine.reach,mine.teams.map(t=>t.rows.map(r=>r.memberId))],['self',[['cs']]],'a member: their own row only');
// Its Excel file
for(const language of ['ar','en']){
 const book=S.performanceWorkbook(view,language),files=unzipSync(book.bytes),names=Object.keys(files);
 eq(book.fileName,'Yourrest-service-performance-2026-11.xlsx','the file\'s name ('+language+')');
 const text=names.filter(n=>/^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort().map(n=>strFromU8(files[n]));
 eq(text.length,3,'three sheets: summary, invoices, opportunities ('+language+')');
 ok(text[0].includes(language==='en'?'Customer-service performance · 2026-11':'أداء خدمة العملاء · 2026-11')&&text[0].includes(language==='en'?'No customer-service manager':'بدون مدير خدمة عملاء'),'the summary: its title and the group without a manager ('+language+')');
 ok(text[1].includes(language==='en'?'Full customer-service sales':'مبيعات بالكامل')&&text[1].includes(language==='en'?'Return':'مرتجع')&&text[1].includes('#72'),'the invoices: the category, the return and the opportunity number ('+language+')');
 ok(text[2].includes('=HYPERLINK(&quot;x&quot;)')||text[2].includes('=HYPERLINK("x")'),'the customer\'s name is written ('+language+')');
 ok(!/<f[ >]/.test(text.join(''))&&/t="inlineStr"[^>]*>(?:<is>)?<t[^>]*>=HYPERLINK/.test(text[2]),'a name that starts like a formula is an inline string, never a formula ('+language+')');
 ok(language==='en'?!text.join('').includes('rightToLeft="1"'):text[0].includes('rightToLeft="1"'),'right to left in Arabic only ('+language+')');
}

// The role tasks
await refusal(as('rep').then(c=>S.roleTasksView(c,'2026-11-16T09:00:00.000Z')),403,/تسجيل دور خدمة العملاء متاح/,'a representative: 403');
const now='2026-11-16T09:00:00.000Z';
const tasks=await S.roleTasksView(cs,now);
eq(tasks.tasks.map(t=>[t.caseId,t.memberId,t.basis,t.outcome,t.number,t.canRecord,typeof t.hours,t.targetHours]),[['case-held','cs','owner','won',72,true,'number',24],['case-lost','cs','registrar','lost',71,true,'number',24]],'the member\'s tasks: the opportunity they kept (owner) and the one they registered (registrar), oldest first');
eq(tasks.counts.mine,2,'two of their own');
const csmTasks=await S.roleTasksView(await as('csm'),now);
eq([csmTasks.tasks.map(t=>[t.caseId,t.canRecord]),csmTasks.counts.mine],[[['case-held',false],['case-lost',false]],0],'the manager follows the team\'s tasks and cannot record them');
eq((await S.roleTasksView(await as('csx'),now)).tasks,[],'another member: none');
await refusal(as('rep').then(c=>S.recordRoleTask(c,{},now)),403,/./,'a representative cannot record');
const task=(extra={})=>({caseId:'case-held',roles:['جلب العميل'],note:'تواصلت مع العميل وأقنعته',requestId:crypto.randomUUID(),...extra});
for(const bad of [{roles:[]},{roles:['دور غير موجود']},{note:'قصير'}])await refusal(S.recordRoleTask(cs,task(bad),now),400,/./,'refused: '+JSON.stringify(bad));
let error;try{await S.recordRoleTask(cs,task({extra:1}),now);}catch(e){error=e;}ok(error?.name==='ZodError','an unknown field: refused by the schema');
await refusal(S.recordRoleTask(cs,task({caseId:'case-open'}),now),404,/المهمة غير متاحة/,'an opportunity with no task');
await refusal(S.recordRoleTask(await as('csm'),task(),now),403,/يسجّل الدور ممثل خدمة العملاء المكلّف/,'the manager cannot record a member\'s task');
eq(await S.recordRoleTask(cs,task({roles:['جلب العميل','جلب العميل','حل شكوى']}),now),{ok:true,caseId:'case-held'},'recorded');
const row=sql.prepare("SELECT * FROM crm_service_role_tasks WHERE case_id='case-held'").get();
eq([row.outcome,row.member_id,row.basis,JSON.parse(row.roles),row.note,row.done_by,row.done_at],['won','cs','owner',['جلب العميل','حل شكوى'],'تواصلت مع العميل وأقنعته','cs',now],'once, each role once');
eq(sql.prepare("SELECT action FROM crm_audit WHERE record_id='case-held'").all().map(r=>r.action),['service:role'],'with its audit line');
eq(await S.recordRoleTask(cs,task(),now),{ok:true,caseId:'case-held',alreadyDone:true},'a second time: already done, nothing written');
eq(sql.prepare("SELECT count(*) AS n FROM crm_audit WHERE record_id='case-held'").get().n,1,'still one line');
const after=await S.roleTasksView(cs,now);
eq([after.tasks.map(t=>[t.caseId,!!t.doneAt,t.doneByName]),after.counts.mine],[[['case-lost',false,''],['case-held',true,'ممثل أول']],1],'the open task first, the recorded one after it with who recorded it');
eq((await S.roleTasksView(cs,'2026-12-20T09:00:00.000Z')).tasks.map(t=>t.caseId),['case-lost'],'a task recorded more than 30 days ago is no longer listed');
eq(await S.recordRoleTask(admin,task({caseId:'case-lost'}),now),{ok:true,caseId:'case-lost'},'the administrator may record any task');

console.log(JSON.stringify({ok:true,checks,syntheticFixtures:true,productionDataUsed:false}));
