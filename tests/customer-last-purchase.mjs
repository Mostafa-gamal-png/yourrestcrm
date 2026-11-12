// «لم يشترِ منذ 60 يومًا» (lib/customer-last-purchase.ts, lib/customer-last-purchase-server.ts): the rule and its one grouped statement over
// the real schema (every drizzle migration in an in-memory SQLite). Boundaries 59/60/61 days (GSCO's: exactly 60 days is still recent);
// ERP returns and non-positive documents never count; an ERP code two customers share counts for neither unless an explicit mapping
// picks one among the code's current holders; a code a customer only had before (a retained alias, a code an ERP import cleared)
// counts for nobody but its current holder (2026-11-12); confirmed manual invoices count, void ones do not; a status other than «نشط» is never listed;
// no sales at all is an empty answer. The rows GET /api/crm sends carry data._lastPurchase only on customers that bought.
// Synthetic data only.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';

const root=process.cwd(),runtime=path.join(root,'.sites-runtime');
fs.mkdirSync(runtime,{recursive:true});
const out=fs.mkdtempSync(path.join(runtime,'customer-last-purchase-')),seen=new Set();
process.on('exit',()=>fs.rmSync(out,{recursive:true,force:true}));
function compile(relative){
 if(seen.has(relative))return;seen.add(relative);
 const src=path.join(root,relative),dest=path.join(out,relative.replace(/\.tsx?$/,'.mjs'));
 fs.mkdirSync(path.dirname(dest),{recursive:true});
 let code=ts.transpileModule(fs.readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 code=code.replace(/from (['"])([^'"]+)\1/g,(match,q,imp)=>{
  if(!imp.startsWith('.')&&!imp.startsWith('@/'))return match;
  let source=imp.startsWith('@/')?imp.slice(2):path.relative(root,path.resolve(path.dirname(src),imp));
  if(!/\.tsx?$/.test(source))source+=fs.existsSync(path.join(root,source+'.ts'))?'.ts':'.tsx';
  compile(source);return 'from '+JSON.stringify(path.join(out,source.replace(/\.tsx?$/,'.mjs')));
 });
 fs.writeFileSync(dest,code);
}
compile('lib/customer-last-purchase-server.ts');
const rule=await import(path.join(out,'lib/customer-last-purchase.mjs'));
const server=await import(path.join(out,'lib/customer-last-purchase-server.mjs'));
const {INACTIVE_CUSTOMER_DAYS,recentSince,noPurchaseSince,activeCustomer,inactiveCustomer,lastPurchaseDates}=rule;
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};

// ---- the window
const today='2026-11-09',day=back=>new Date(Date.parse(today+'T00:00:00Z')-back*86400000).toISOString().slice(0,10);
eq(INACTIVE_CUSTOMER_DAYS,60,'sixty days');
eq(recentSince(today),day(60),'the first recent day is today minus 60 days');
eq([59,60,61].map(back=>noPurchaseSince(day(back),today)),[false,false,true],'59 and 60 days ago are recent, 61 is not (GSCO\'s boundary)');
eq([noPurchaseSince(undefined,today),noPurchaseSince('',today),noPurchaseSince('not a date',today),noPurchaseSince(today,today)],[true,true,true,false],'no purchase (or an unreadable one) is inactive; today is recent');
eq(noPurchaseSince(day(31),today,30),true,'another window may be passed');
eq([recentSince('2026-03-01'),recentSince('2024-03-01')],['2025-12-31','2024-01-01'],'across a year and a leap February');

// ---- the status: only «نشط» (as the map reads it); no status is «غير محدد», not active
const customer=(id,data={})=>({id,kind:'customer',parentId:null,assignedTo:'rep',branch:'الرئيسي',data:{name:id,customerStatus:'نشط',...data},createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z',version:1});
eq(['نشط',' نشط ','Active','نصف نشط','خامل','','something'].map(status=>activeCustomer({data:{customerStatus:status}})),[true,true,true,false,false,false,false],'«نشط» only');
eq(activeCustomer({data:{}}),false,'a customer without a status is not active');
eq([inactiveCustomer(customer('a',{_lastPurchase:day(61)}),today),inactiveCustomer(customer('b',{_lastPurchase:day(60)}),today),inactiveCustomer(customer('c'),today)],[true,false,true],'an active customer: 61 days or no purchase listed, 60 days not');
eq([inactiveCustomer(customer('d',{customerStatus:'خامل',_lastPurchase:day(200)}),today),inactiveCustomer(customer('e',{customerStatus:'نصف نشط'}),today),inactiveCustomer(customer('f',{customerStatus:''}),today)],[false,false,false],'an inactive, half-active or unspecified customer is never listed');

// ---- the statement over the real schema
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const file of fs.readdirSync('drizzle').filter(file=>/^\d+.*\.sql$/.test(file)).sort())sql.exec(fs.readFileSync('drizzle/'+file,'utf8'));
class Statement{constructor(query,args=[]){this.query=query;this.args=args;}bind(...args){return new Statement(this.query,args);}async all(){return{results:sql.prepare(this.query).all(...this.args).map(row=>({...row}))};}async first(){const row=sql.prepare(this.query).get(...this.args);return row?{...row}:null;}}
const DB={prepare:query=>new Statement(query)};
const plan=sql.prepare('EXPLAIN QUERY PLAN '+server.LAST_PURCHASE_SQL).all().map(row=>row.detail).join(' | ');
eq(/crm_erp_sales/.test(plan)&&/crm_sales/.test(plan),true,'one statement reads both tables: '+plan);
eq(await server.readLastPurchases(DB,[customer('a')]),new Map(),'no sales at all: nobody has a purchase');
sql.exec("INSERT INTO crm_members(id,user_id,email,name,role,branch,supervisor_id,active,target,created_at,region_scope) VALUES('rep','u-rep','rep@yourrest.org','rep','rep','الرئيسي',NULL,1,0,'2026-01-01','all')");
sql.exec("INSERT INTO crm_erp_imports(id,actor_id,fingerprint,file_name,result,created_at) VALUES('imp','rep','f','sales.xml','{}','2026-01-01')");
const all=[
 customer('a',{code:'C-1'}),customer('c2',{code:'C-2'}),customer('s1',{code:'SHARED'}),customer('s2',{code:'shared'}),
 customer('m1',{code:'MAPPED'}),customer('m2',{code:'MAPPED'}),customer('alias',{code:'NEW-7',_erpCodeAliases:['OLD-7']}),customer('arabic',{code:'77'}),
 customer('m-manual'),customer('void-only'),customer('none',{code:'Z-9'}),
 {id:'machine',kind:'factory',parentId:'a',assignedTo:'rep',branch:'الرئيسي',data:{name:'خط'},createdAt:'',updatedAt:'',version:1}
];
for(const row of all)sql.prepare('INSERT INTO crm_records(id,kind,parent_id,assigned_to,branch,data,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)').run(row.id,row.kind,row.parentId,row.assignedTo,row.branch,JSON.stringify(row.data),row.createdAt,row.updatedAt);
let n=0;
const erp=(code,date,type='sale',total=1000)=>sql.prepare("INSERT INTO crm_erp_sales(id,document_key,content_hash,mapped_hash,reference,document_type,date,employee_id,rep_id,branch,region_scope,customer_code,customer_name,data,total_cents,import_id,created_by,created_at) VALUES(?,?,'h','h',?,?,?,'e1','rep','الرئيسي','all',?,'n','{}',?,'imp','rep','2026-01-01')").run('erp-'+(++n),'doc-'+n,'INV-'+n,type,date,code,total);
const manual=(customerId,date,status='confirmed')=>sql.prepare("INSERT INTO crm_sales(id,customer_id,rep_id,branch,date,reference,reference_key,data,total_cents,status,version,mutation_id,create_fingerprint,created_by,created_at,updated_at) VALUES(?,?,'rep','الرئيسي',?,?,?,'{}',5000,?,1,?,'f','rep','2026-01-01','2026-01-01')").run('sale-'+(++n),customerId,date,'M-'+n,'m-'+n,status,'mut-'+n);
// C-1: two sales, the later counts; a later RETURN and a later non-positive sale do not
erp('C-1',day(100));erp('c-1 ',day(59));erp('C-1',day(5),'return',-500);erp('C-1',day(3),'sale',0);
// C-2: only returns (one with a positive total, as a credit note could be stored), so no purchase
erp('C-2',day(1),'return',-100);erp('C-2',day(2),'return',100);
// SHARED: the code of two customers, counts for neither
erp('SHARED',day(2));
// MAPPED: shared by two too, but an explicit mapping picks «m1»
erp('MAPPED',day(4));
// OLD-7: only the previous code of «alias» (now NEW-7): nobody's purchase since 2026-11-12
erp('OLD-7',day(70));
// ٧٧: Arabic-Indic digits are the same code as 77
erp('٧٧',day(61));
// nobody's code
erp('NOBODY',day(1));
// manual invoices: confirmed counts and wins when later; void does not
manual('m-manual',day(20));manual('a',day(10));manual('void-only',day(1),'void');
sql.exec("INSERT INTO crm_customer_code_mappings(code_key,customer_id,version,updated_by,updated_at) VALUES('MAPPED','m1',1,'owner','2026-01-01')");
const latest=await server.readLastPurchases(DB,all);
eq(Object.fromEntries([...latest].sort()),{a:day(10),arabic:day(61),m1:day(4),'m-manual':day(20)},'the latest sale per customer: C-1\'s later manual invoice beats its ERP sale of 59 days, returns and zero totals ignored, a shared code ignored, a mapped one counted, an old code (alias) not matched, Arabic digits matched, a void invoice ignored');
const cleared=customer('cleared',{code:'',_erpCodeAliases:['OLD-7']}),holder7=customer('holder7',{code:'OLD-7'});
eq(Object.fromEntries(lastPurchaseDates([cleared,holder7],[],[{source:'erp',key:'OLD-7',date:day(70)}])),{holder7:day(70)},'a cleared customer\'s old code: the purchase is the current holder\'s');
eq(Object.fromEntries(lastPurchaseDates([cleared,holder7],[{codeKey:'OLD-7',customerId:'cleared',version:1}],[{source:'erp',key:'OLD-7',date:day(70)}])),{holder7:day(70)},'and a stored mapping to the cleared customer changes nothing: the current holder wins');
eq(lastPurchaseDates([cleared],[],[{source:'erp',key:'OLD-7',date:day(70)}]).size,0,'nobody carries the code now: nobody bought');
eq(lastPurchaseDates(all.filter(row=>row.id!=='s2'),[],[{source:'erp',key:'SHARED',date:day(2)}]).get('s1'),day(2),'the same code held by one customer only counts for it');
eq(lastPurchaseDates(all,[],[{source:'erp',key:'C-1',date:'garbage'},{source:'crm',key:'a',date:''}]).size,0,'unreadable dates are not purchases');
eq(lastPurchaseDates(all,[],[{source:'crm',key:'machine',date:day(1)},{source:'crm',key:'ghost',date:day(1)}]).size,0,'a manual invoice counts only for a customer of the directory');

// ---- the rows GET /api/crm sends
const sent=server.withLastPurchase(all,latest);
eq(sent.filter(row=>row.data._lastPurchase).map(row=>row.id).sort(),['a','arabic','m-manual','m1'],'only customers that bought carry _lastPurchase');
eq(sent.find(row=>row.id==='machine'),all.find(row=>row.id==='machine'),'other kinds are passed through unchanged');
eq(sent.find(row=>row.id==='none'),all.find(row=>row.id==='none'),'a customer without a purchase is passed through as it is');
eq(all.find(row=>row.id==='a').data._lastPurchase,undefined,'the loaded rows are not changed');
eq(server.withLastPurchase([customer('stale',{_lastPurchase:'2020-01-01'})],new Map())[0].data._lastPurchase,undefined,'a stray stored value is never sent as if computed');
const listed=sent.filter(row=>row.kind==='customer'&&inactiveCustomer(row,today)).map(row=>row.id).sort();
eq(listed,['alias','arabic','c2','m2','none','s1','s2','void-only'],'«لم يشترِ منذ 60 يومًا»: no purchase, or the last 61 days ago');
console.log(JSON.stringify({suite:'customer last purchase',checks,passed:true}));
